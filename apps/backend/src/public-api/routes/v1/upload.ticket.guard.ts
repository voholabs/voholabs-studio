import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  mixin,
  Type,
} from '@nestjs/common';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

/**
 * Looks the upload ticket up before anything reads the request body. Guards
 * run before interceptors, so a request without a live ticket is turned away
 * before multer starts taking the file in. The handler still claims the ticket
 * itself (in one step), since it may have been used in between.
 */
export const UploadTicketGuard = (
  keyOf: (token: string) => string
): Type<CanActivate> => {
  @Injectable()
  class Guard implements CanActivate {
    async canActivate(context: ExecutionContext) {
      const token = context.switchToHttp().getRequest()?.params?.token;
      if (!token || typeof token !== 'string' || !(await ioRedis.get(keyOf(token)))) {
        throw new HttpException(
          { msg: 'This upload link is invalid or has expired.' },
          404
        );
      }
      return true;
    }
  }
  return mixin(Guard);
};
