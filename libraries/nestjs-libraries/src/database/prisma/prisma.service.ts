import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
} from '@gitroom/helpers/auth/auth.service';

// Channel credentials on Integration rows. They are encrypted on every write
// and decrypted on every read here, in one place, so a leaked database or
// backup holds no usable token and no repository has to remember to do it.
// Prisma middleware ($use) is gone from Prisma 6.14: moving past it means
// porting this to a $extends query extension (channel.secrets.spec.ts fails
// first).
const CHANNEL_SECRET_FIELDS = ['token', 'refreshToken'];
const INTEGRATION_WRITES = [
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
];

const encryptChannelSecrets = (data: any) => {
  if (Array.isArray(data)) {
    data.forEach(encryptChannelSecrets);
    return;
  }
  if (!data || typeof data !== 'object') {
    return;
  }
  for (const field of CHANNEL_SECRET_FIELDS) {
    if (typeof data[field] === 'string') {
      data[field] = encryptSecret(data[field]);
    } else if (typeof data[field]?.set === 'string') {
      data[field].set = encryptSecret(data[field].set);
    }
  }
};

const decryptChannelSecrets = (value: any): any => {
  if (Array.isArray(value)) {
    value.forEach(decryptChannelSecrets);
    return value;
  }
  if (!value || typeof value !== 'object' || value.constructor !== Object) {
    return value;
  }
  for (const key of Object.keys(value)) {
    if (CHANNEL_SECRET_FIELDS.includes(key) && isEncryptedSecret(value[key])) {
      value[key] = decryptSecret(value[key]);
    } else if (value[key] && typeof value[key] === 'object') {
      decryptChannelSecrets(value[key]);
    }
  }
  return value;
};

export const channelSecretsMiddleware: Prisma.Middleware = async (
  params,
  next
) => {
  if (
    params.model === 'Integration' &&
    INTEGRATION_WRITES.includes(params.action)
  ) {
    encryptChannelSecrets(params.args?.data);
    encryptChannelSecrets(params.args?.create);
    encryptChannelSecrets(params.args?.update);
  }
  return decryptChannelSecrets(await next(params));
};

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      log: [
        {
          emit: 'event',
          level: 'query',
        },
      ],
    });
    this.$use(channelSecretsMiddleware);
  }
  async onModuleInit() {
    try {
      encryptSecret('key check');
    } catch (err) {
      console.error(
        'ENCRYPTION_KEY is missing or invalid: connecting and refreshing channels will fail'
      );
    }
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

@Injectable()
export class PrismaRepository<T extends keyof PrismaService> {
  public model: Pick<PrismaService, T>;
  constructor(private _prismaService: PrismaService) {
    this.model = this._prismaService;
  }
}

@Injectable()
export class PrismaTransaction {
  public model: Pick<PrismaService, '$transaction'>;
  constructor(private _prismaService: PrismaService) {
    this.model = this._prismaService;
  }
}
