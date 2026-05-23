import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FavoriteTarget } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(userId: string) {
    const profile = await this.prisma.profile.findUnique({
      where: { id: userId },
      include: {
        city: { select: { code: true, name: true } },
        _count: { select: { trips: true, favorites: true } },
      },
    });
    if (!profile) {
      throw new NotFoundException('Profile not found');
    }
    return {
      id: profile.id,
      email: profile.email,
      name: profile.name,
      city_code: profile.city.code,
      city_name: profile.city.name,
      favorites_count: profile._count.favorites,
      trips_count: profile._count.trips,
    };
  }

  async listFavorites(userId: string) {
    const rows = await this.prisma.favorite.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        landmark: {
          select: { id: true, name: true, type: true, address: true },
        },
      },
    });

    // For ROUTE favorites we have to look up the route separately (no direct relation)
    const routeIds = rows
      .filter((r) => r.targetType === FavoriteTarget.ROUTE && r.routeId)
      .map((r) => r.routeId!);
    const routes = routeIds.length
      ? await this.prisma.route.findMany({
          where: { id: { in: routeIds } },
          select: { id: true, code: true, name: true, color: true, mode: true },
        })
      : [];
    const routesById = new Map(routes.map((r) => [r.id, r]));

    return {
      favorites: rows.map((f) => ({
        id: f.id,
        target_type: f.targetType,
        alias: f.alias,
        created_at: f.createdAt,
        landmark: f.targetType === FavoriteTarget.LANDMARK ? f.landmark : null,
        route:
          f.targetType === FavoriteTarget.ROUTE && f.routeId
            ? routesById.get(f.routeId) ?? null
            : null,
      })),
    };
  }

  async createFavorite(params: {
    userId: string;
    targetType: FavoriteTarget;
    targetId: string;
    alias?: string;
  }) {
    // Validate target exists
    if (params.targetType === FavoriteTarget.LANDMARK) {
      const exists = await this.prisma.landmark.findUnique({
        where: { id: params.targetId },
        select: { id: true },
      });
      if (!exists) throw new BadRequestException('Landmark not found');
    } else {
      const exists = await this.prisma.route.findUnique({
        where: { id: params.targetId },
        select: { id: true },
      });
      if (!exists) throw new BadRequestException('Route not found');
    }

    const created = await this.prisma.favorite.create({
      data: {
        userId: params.userId,
        targetType: params.targetType,
        landmarkId:
          params.targetType === FavoriteTarget.LANDMARK ? params.targetId : null,
        routeId:
          params.targetType === FavoriteTarget.ROUTE ? params.targetId : null,
        alias: params.alias,
      },
    });
    return { id: created.id };
  }

  async deleteFavorite(userId: string, id: string) {
    const result = await this.prisma.favorite.deleteMany({
      where: { id, userId },
    });
    if (result.count === 0) {
      throw new NotFoundException('Favorite not found');
    }
    return { deleted: true };
  }
}
