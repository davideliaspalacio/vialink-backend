import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CitiesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve a city id by its short code (e.g. 'BAQ').
   * Throws if not found — most callers expect a guaranteed city.
   */
  async getIdByCode(code: string): Promise<string> {
    const city = await this.prisma.city.findUnique({
      where: { code: code.toUpperCase() },
      select: { id: true },
    });
    if (!city) {
      throw new NotFoundException(`City "${code}" not found`);
    }
    return city.id;
  }

  async list() {
    return this.prisma.city.findMany({
      select: { id: true, code: true, name: true },
      orderBy: { name: 'asc' },
    });
  }
}
