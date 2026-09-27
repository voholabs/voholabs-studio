import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiTags } from '@nestjs/swagger';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';

@ApiTags('Health')
@Controller('/health')
export class HealthController {
  constructor(private _postsService: PostsService) {}

  // Liveness only, on purpose. This exists to catch the backend being alive
  // but never bound to :3000 (which reads as "online" to pm2), so it must not
  // touch Postgres or Redis — a transient dependency blip would otherwise
  // report the app as down while it is still serving traffic fine.
  //
  // Unauthenticated: registered outside `authenticatedController` in
  // api.module.ts, so AuthMiddleware never runs for it.
  @SkipThrottle()
  @Get('/')
  health() {
    return {
      status: 'ok',
      uptime: Math.floor(process.uptime()),
    };
  }

  // Publishing check for the external watchdog. Unlike liveness it reads
  // Postgres and pings the scheduler, so it catches the case where every
  // process is up but posts have stopped going out. 503 when stalled.
  // Counts only, no post content.
  @SkipThrottle()
  @Get('/publishing')
  async publishing(@Res() res: Response) {
    const health = await this._postsService.publishingHealth();
    res.status(health.healthy ? 200 : 503).json(health);
  }
}
