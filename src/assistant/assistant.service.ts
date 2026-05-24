import Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../config/configuration';
import type { LatLng } from '../common/types/geo';
import { PrismaService } from '../prisma/prisma.service';
import { AssistantToolsService } from './tools/assistant-tools.service';
import { ASSISTANT_TOOLS } from './tools/tool-definitions';

export interface AskResult {
  answer: string;
  suggested_action: SuggestedAction | null;
  latency_ms: number;
  tool_calls: ToolCallSummary[];
}

export type SuggestedAction =
  | {
      type: 'START_TRIP';
      payload: {
        route_id: string;
        route_code: string;
        boarding_location: LatLng;
        dropoff_landmark_id?: string;
        dropoff_location?: LatLng;
        estimated_duration_seconds: number;
      };
    }
  | { type: 'SHOW_ROUTE'; payload: { route_id: string } }
  | { type: 'SHOW_LANDMARK'; payload: { landmark_id: string } }
  | {
      type: 'OPEN_WAIT_PIN';
      payload: { location: LatLng; route_id?: string };
    };

interface ToolCallSummary {
  name: string;
  input: Record<string, unknown>;
  ms: number;
}

const SYSTEM_PROMPT = `Eres el asistente de Vialink, una app de transporte público para Barranquilla, Colombia. \
Tu trabajo es ayudar al usuario a moverse por la ciudad usando buses tradicionales (que paran en cualquier parte) y Transmetro.

Reglas:
1. Habla en español neutro colombiano, breve y directo. Máximo 2-3 frases por respuesta.
2. Usa las tools para obtener datos reales — NUNCA inventes rutas, paraderos, ni tiempos.
3. Si el usuario menciona el NOMBRE de un lugar conocido (Uninorte, Olímpica, Centro, Buenavista, etc.), usa find_landmark primero.
4. Si el usuario menciona una DIRECCIÓN (Calle 84 con Cra 50, Diagonal 23 #45-67, una esquina específica), usa geocode_address para obtener sus coordenadas.
5. Una vez tengas coordenadas (de landmark o geocode), usa calculate_trip para encontrar la mejor ruta.
6. Si pregunta cuándo viene el bus en su ubicación, usa get_buses_at_point con su ubicación.
7. Si te falta la ubicación del usuario y la necesitas, pregúntale.
8. NOMENCLATURA DE RUTAS — REGLA CRÍTICA:
   - SIEMPRE usá el NOMBRE descriptivo de la ruta cuando le hables al usuario.
     Ejemplos: "Sabanilla - Centro", "Centro - Uninorte", "Las Flores - Centro".
   - NUNCA digas solo el código técnico ("C12", "S12", "T1") en tu respuesta —
     el usuario común no sabe qué significa.
   - Si querés agregar el código entre paréntesis para claridad, OK:
     "la ruta Sabanilla - Centro (S12)" ✓
   - Si la ruta es Transmetro (mode = BRT), mencionalo:
     "el Transmetro Soledad - Centro" en vez de "T1".
   - Si es tradicional, decí "el bus de Sabanilla - Centro" o "la ruta
     Sabanilla - Centro".
9. Cuando recomiendes una ruta, decí: nombre descriptivo + tiempo total
   + alternativas si las hay. Ejemplo: "Te recomiendo el bus Sabanilla -
   Centro, llega en 4 min y demora ~19 min total. También podés tomar
   Centro - Uninorte si querés."
10. No menciones IDs internos (UUIDs, route_id, bus_id) en tu respuesta —
    son para el frontend, no para el usuario.
11. Si no encuentras una opción, dilo honestamente.`;

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  private readonly anthropic: Anthropic;
  private readonly model: string;
  private readonly MAX_TOOL_ITERATIONS = 5;
  private readonly REQUEST_TIMEOUT_MS = 15_000;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly tools: AssistantToolsService,
    private readonly prisma: PrismaService,
  ) {
    this.anthropic = new Anthropic({
      apiKey: config.get('ANTHROPIC_API_KEY', { infer: true }),
      timeout: this.REQUEST_TIMEOUT_MS,
    });
    this.model = config.get('ANTHROPIC_MODEL', { infer: true });
  }

  async ask(params: {
    userId: string;
    question: string;
    location?: LatLng;
    currentTripId?: string;
  }): Promise<AskResult> {
    const start = Date.now();
    const toolCalls: ToolCallSummary[] = [];

    // Build initial user message with embedded context
    const contextLines: string[] = [];
    if (params.location) {
      contextLines.push(
        `[Ubicación del usuario: lat=${params.location.lat.toFixed(5)}, lng=${params.location.lng.toFixed(5)}]`,
      );
    }
    if (params.currentTripId) {
      contextLines.push(`[Usuario tiene un viaje activo en curso]`);
    }
    const userContent =
      contextLines.length > 0
        ? `${contextLines.join('\n')}\n\n${params.question}`
        : params.question;

    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: userContent },
    ];

    let answer = '';
    let suggestedAction: SuggestedAction | null = null;

    for (let iter = 0; iter < this.MAX_TOOL_ITERATIONS; iter++) {
      const response = await this.callClaude(messages);

      // Capture final assistant message blocks
      const textBlocks: string[] = [];
      const toolUses: Anthropic.ToolUseBlock[] = [];
      for (const block of response.content) {
        if (block.type === 'text') textBlocks.push(block.text);
        else if (block.type === 'tool_use') toolUses.push(block);
      }

      // If no tool use, this is the final answer
      if (toolUses.length === 0) {
        answer = textBlocks.join('\n').trim();
        suggestedAction = this.inferAction(answer, toolCalls, params);
        break;
      }

      // Add assistant turn to history (must include tool_use blocks intact)
      messages.push({ role: 'assistant', content: response.content });

      // Execute each tool and feed results back
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tu of toolUses) {
        const toolStart = Date.now();
        const result = await this.tools.invoke(
          tu.name,
          tu.input as Record<string, unknown>,
        );
        toolCalls.push({
          name: tu.name,
          input: tu.input as Record<string, unknown>,
          ms: Date.now() - toolStart,
        });
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(result),
        });
      }
      messages.push({ role: 'user', content: toolResults });
    }

    if (!answer) {
      // We hit MAX_TOOL_ITERATIONS without a final text answer
      answer =
        'No pude resolver tu solicitud en este momento. Intenta reformularla.';
    }

    const latencyMs = Date.now() - start;
    this.logger.log(
      `assistant.ask in ${latencyMs}ms with ${toolCalls.length} tool calls`,
    );

    // Persist (fire and forget — failures shouldn't block response)
    this.persistMessage({
      userId: params.userId,
      question: params.question,
      answer,
      suggestedAction,
      latencyMs,
      toolCalls,
    }).catch((err) => this.logger.error('Failed to persist assistant message', err));

    return {
      answer,
      suggested_action: suggestedAction,
      latency_ms: latencyMs,
      tool_calls: toolCalls,
    };
  }

  async listMessages(userId: string, limit: number) {
    const rows = await this.prisma.assistantMessage.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        question: true,
        answer: true,
        suggestedAction: true,
        latencyMs: true,
        createdAt: true,
      },
    });
    return {
      messages: rows.map((r) => ({
        id: r.id,
        question: r.question,
        answer: r.answer,
        suggested_action: r.suggestedAction,
        latency_ms: r.latencyMs,
        created_at: r.createdAt,
      })),
    };
  }

  // ---------- Internals ----------

  private async callClaude(
    messages: Anthropic.MessageParam[],
  ): Promise<Anthropic.Message> {
    try {
      return await this.anthropic.messages.create({
        model: this.model,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        tools: ASSISTANT_TOOLS,
        messages,
      });
    } catch (err) {
      this.logger.error('Claude call failed', err);
      throw new ServiceUnavailableException(
        'El asistente no está disponible en este momento',
      );
    }
  }

  /**
   * Heuristic to derive a `suggested_action` from the tool calls Claude made.
   *
   * We don't ask Claude to emit structured output — easier to keep the
   * prompt focused on natural language and infer action from tool history.
   */
  private inferAction(
    answer: string,
    toolCalls: ToolCallSummary[],
    params: { location?: LatLng },
  ): SuggestedAction | null {
    const last = toolCalls[toolCalls.length - 1];
    if (!last) return null;

    // calculate_trip → suggest START_TRIP with the best option
    if (last.name === 'calculate_trip') {
      // We could re-execute or store last result; here we use a simpler signal:
      // if the user asked "cómo llego" semantically, offer START_TRIP via the route
      // mentioned in the answer text. We extract the route code (e.g., "C12") from
      // the answer.
      const codeMatch = answer.match(/\b([A-Z]\d{1,2})\b/);
      if (codeMatch && params.location) {
        // We don't have route_id without re-querying; leave generic SHOW_ROUTE-by-code
        // and let frontend do a final lookup, OR provide OPEN_WAIT_PIN.
        return {
          type: 'OPEN_WAIT_PIN',
          payload: {
            location: params.location,
          },
        };
      }
    }

    // find_landmark only → SHOW_LANDMARK with the first result if mentioned
    if (last.name === 'find_landmark') {
      const lmId = (last.input as { _id?: string })._id;
      if (lmId) {
        return { type: 'SHOW_LANDMARK', payload: { landmark_id: lmId } };
      }
    }

    // get_buses_at_point with user's location → OPEN_WAIT_PIN
    if (last.name === 'get_buses_at_point' && params.location) {
      return {
        type: 'OPEN_WAIT_PIN',
        payload: { location: params.location },
      };
    }

    return null;
  }

  private async persistMessage(params: {
    userId: string;
    question: string;
    answer: string;
    suggestedAction: SuggestedAction | null;
    latencyMs: number;
    toolCalls: ToolCallSummary[];
  }) {
    await this.prisma.assistantMessage.create({
      data: {
        userId: params.userId,
        question: params.question,
        answer: params.answer,
        suggestedAction: params.suggestedAction as never,
        latencyMs: params.latencyMs,
        toolCalls: params.toolCalls as never,
      },
    });
  }
}
