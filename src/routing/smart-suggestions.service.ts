import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import type { AppConfig } from '../config/configuration';
import type { RouteRecommendation } from './routing.service';

/**
 * Vialink — Smart suggestions service.
 *
 * Encima de las recomendaciones de RoutingService.recommend(), aplica
 * HEURÍSTICAS para detectar oportunidades smart (alternativas más rápidas
 * si esperás, paraderos más cerca con buses directos, etc.) y opcionalmente
 * usa LLM (Claude Haiku) para darles voz natural en español colombiano.
 *
 * Diseño: heurísticas → estructura → LLM solo para "wording".
 * Esto hace el costo predecible: ~$0.002 por request (1 sola call al LLM
 * con tokens chicos).
 */

export interface SmartSuggestion {
  /** Identificador del tipo de heurística, útil para tracking/analytics */
  type:
    | 'alternative_faster'
    | 'alternative_less_walking'
    | 'alternative_transmetro'
    | 'arrive_just_in_time';
  /** Texto en lenguaje natural mostrado al user */
  text: string;
  /** Rank del recommendation alternativo que se sugiere (1-indexed). */
  alternative_rank: number;
  /** Ganancia: cuántos minutos ahorra esta sugerencia vs la primary */
  savings_minutes: number;
  /** Costo: cuántos minutos más tiene que esperar/caminar el user para esto */
  tradeoff_minutes?: number;
}

@Injectable()
export class SmartSuggestionsService {
  private readonly logger = new Logger(SmartSuggestionsService.name);
  private readonly anthropic: Anthropic | null;
  private readonly model: string;

  constructor(config: ConfigService<AppConfig, true>) {
    const apiKey = config.get('ANTHROPIC_API_KEY', { infer: true });
    this.model =
      config.get('ANTHROPIC_MODEL', { infer: true }) ??
      'claude-haiku-4-5-20251001';
    if (apiKey && !apiKey.includes('PLACEHOLDER')) {
      this.anthropic = new Anthropic({ apiKey, timeout: 8000 });
    } else {
      this.anthropic = null;
      this.logger.warn(
        '⚠️  ANTHROPIC_API_KEY no configurada — smart suggestions usarán texto plantilla (sin LLM).',
      );
    }
  }

  /**
   * Dado el array de recomendaciones del routing engine, detecta oportunidades
   * smart y devuelve las sugerencias con texto natural.
   *
   * Si no hay alternativas o ninguna es lo suficientemente "smart" como para
   * sugerir, devuelve [].
   */
  async generate(
    recommendations: RouteRecommendation[],
  ): Promise<SmartSuggestion[]> {
    if (recommendations.length < 2) return [];

    const primary = recommendations[0];
    const alternatives = recommendations.slice(1);

    // Aplicar heurísticas → estructura inicial sin wording natural
    const drafts: Omit<SmartSuggestion, 'text'>[] = [];

    for (let i = 0; i < alternatives.length; i++) {
      const alt = alternatives[i];
      const altRank = i + 2; // alternatives[0] es rank 2, etc.

      // Heurística 1: alternativa LLEGA ANTES en total
      if (alt.total_minutes < primary.total_minutes) {
        drafts.push({
          type: 'alternative_faster',
          alternative_rank: altRank,
          savings_minutes: primary.total_minutes - alt.total_minutes,
          tradeoff_minutes: Math.max(
            0,
            alt.bus.wait_minutes - primary.bus.wait_minutes,
          ),
        });
      }

      // Heurística 2: alternativa requiere MENOS caminata total
      const primaryWalk =
        primary.walking_to_board.blocks + primary.walking_from_alight.blocks;
      const altWalk =
        alt.walking_to_board.blocks + alt.walking_from_alight.blocks;
      if (
        altWalk < primaryWalk &&
        alt.total_minutes <= primary.total_minutes + 5
      ) {
        drafts.push({
          type: 'alternative_less_walking',
          alternative_rank: altRank,
          savings_minutes: 0,
          tradeoff_minutes: Math.max(
            0,
            alt.total_minutes - primary.total_minutes,
          ),
        });
      }

      // Heurística 3: alternativa es Transmetro y primary no
      // (T seguido de dígito = BRT real, evita falsos positivos como M9)
      const isAltBrt = /^T\d/.test(alt.bus.route_code);
      const isPrimaryBrt = /^T\d/.test(primary.bus.route_code);
      if (
        isAltBrt &&
        !isPrimaryBrt &&
        alt.total_minutes <= primary.total_minutes + 8
      ) {
        drafts.push({
          type: 'alternative_transmetro',
          alternative_rank: altRank,
          savings_minutes: Math.max(
            0,
            primary.total_minutes - alt.total_minutes,
          ),
          tradeoff_minutes: Math.max(
            0,
            alt.total_minutes - primary.total_minutes,
          ),
        });
      }
    }

    // Dedup por tipo: máximo 1 sugerencia por tipo (la mejor)
    const seen = new Set<string>();
    const unique = drafts.filter((d) => {
      if (seen.has(d.type)) return false;
      seen.add(d.type);
      return true;
    });

    // Cap a 2 sugerencias máximo (no saturar al user)
    const top = unique.slice(0, 2);
    if (top.length === 0) return [];

    // Generar wording natural en 1 sola call al LLM
    const withText = await this.addNaturalWording(top, recommendations);
    return withText;
  }

  private async addNaturalWording(
    drafts: Omit<SmartSuggestion, 'text'>[],
    recs: RouteRecommendation[],
  ): Promise<SmartSuggestion[]> {
    // Fallback rápido sin LLM: plantilla
    const templated = drafts.map((d) =>
      this.fallbackTemplate(d, recs),
    );

    if (!this.anthropic) return templated;

    // 1 sola call para todas las sugerencias (eficiente)
    try {
      const prompt = this.buildPrompt(drafts, recs);
      const res = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: 400,
        system:
          'Eres un asistente de transporte público de Barranquilla. Tu tarea: reescribir sugerencias técnicas como frases breves, naturales y útiles en español colombiano. Máximo 1 frase por sugerencia, tipo "Si esperas X min más, podés tomar el bus Y que te deja Z min más rápido". NUNCA uses códigos como C12, S12, T1 — usá siempre el nombre descriptivo de la ruta.',
        messages: [{ role: 'user', content: prompt }],
      });

      const textBlock = res.content.find((b) => b.type === 'text');
      if (!textBlock || textBlock.type !== 'text') return templated;

      const lines = textBlock.text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      // Esperamos N líneas, una por sugerencia, en el mismo orden
      return drafts.map((d, i) => ({
        ...d,
        text: lines[i] ?? this.fallbackTemplate(d, recs).text,
      }));
    } catch (err) {
      this.logger.warn(
        `LLM wording falló (${(err as Error).message}). Usando plantilla.`,
      );
      return templated;
    }
  }

  private buildPrompt(
    drafts: Omit<SmartSuggestion, 'text'>[],
    recs: RouteRecommendation[],
  ): string {
    const primary = recs[0];
    const lines: string[] = [
      `Recomendación principal: ruta ${primary.bus.route_name}, total ${primary.total_minutes} min, espera ${primary.bus.wait_minutes} min, caminás ${primary.walking_to_board.blocks + primary.walking_from_alight.blocks} cuadras.`,
      '',
      'Sugerencias smart a reescribir:',
    ];
    for (let i = 0; i < drafts.length; i++) {
      const d = drafts[i];
      const alt = recs[d.alternative_rank - 1];
      lines.push(
        `${i + 1}. Tipo: ${d.type} | Ruta alternativa: ${alt.bus.route_name} | total ${alt.total_minutes} min | espera ${alt.bus.wait_minutes} min | caminás ${alt.walking_to_board.blocks + alt.walking_from_alight.blocks} cuadras | ahorra ${d.savings_minutes} min | cuesta ${d.tradeoff_minutes ?? 0} min más`,
      );
    }
    lines.push('');
    lines.push(
      `Devolveme ${drafts.length} frase(s), UNA POR LÍNEA, sin numerar, sin guiones, sin emojis. Tono amigable colombiano. Máx 20 palabras por frase.`,
    );
    return lines.join('\n');
  }

  private fallbackTemplate(
    d: Omit<SmartSuggestion, 'text'>,
    recs: RouteRecommendation[],
  ): SmartSuggestion {
    const alt = recs[d.alternative_rank - 1];
    const altName = alt.bus.route_name;
    let text = '';
    switch (d.type) {
      case 'alternative_faster':
        text = `Si esperás ${d.tradeoff_minutes ?? 0} min más, podés tomar ${altName} y llegás ${d.savings_minutes} min antes.`;
        break;
      case 'alternative_less_walking':
        text = `También podés tomar ${altName} y caminás menos cuadras.`;
        break;
      case 'alternative_transmetro':
        text = `Si preferís Transmetro, ${altName} también te lleva.`;
        break;
      case 'arrive_just_in_time':
        text = `Tomá ${altName} y llegás justo a tiempo.`;
        break;
    }
    return { ...d, text };
  }
}
