import { Injectable } from '@nestjs/common';

export abstract class AuthProviderAbstract {
  /**
   * True for a provider that sends the browser through a redirect. Its login
   * link then carries a one-time `state` that the callback has to bring back
   * (AuthService.oauthLink / checkExists), so a sign-in cannot be started on
   * somebody else's behalf. Farcaster and Wallet have no redirect: the wallet
   * signs a server challenge instead, and Farcaster's signer is approved inside
   * Neynar's own widget, so there is no callback to carry a state.
   */
  readonly requiresState: boolean = false;
  abstract generateLink(query?: any, state?: string): Promise<string> | string;
  abstract getToken(code: string, redirectUri?: string): Promise<string>;
  abstract getUser(
    providerToken: string
  ): Promise<{ email: string; id: string }> | false;
  async postRegistration(
    providerToken: string,
    orgId: string
  ): Promise<void> {}
}

export interface AuthProviderParams {
  provider: string;
}

export function AuthProvider(params: AuthProviderParams) {
  return function (target: any) {
    Injectable()(target);

    const existingMetadata =
      Reflect.getMetadata('auth-provider', AuthProviderAbstract) || [];

    existingMetadata.push({ target, provider: params.provider });

    Reflect.defineMetadata(
      'auth-provider',
      existingMetadata,
      AuthProviderAbstract
    );
  };
}
