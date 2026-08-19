declare module "googleapis" {
  type CalendarEvent = {
    id?: string;
    summary?: string;
  };

  type CalendarResponse = {
    data: {
      id?: string;
      items?: CalendarEvent[];
    };
  };

  type OAuthTokens = {
    access_token?: string;
    expiry_date?: number;
    [key: string]: unknown;
  };

  class OAuth2 {
    constructor(clientId: string, clientSecret: string, redirectUri: string);
    generateAuthUrl(options: {
      access_type: string;
      prompt: string;
      scope: string[];
      state: string;
    }): string;
    getToken(code: string): Promise<{ tokens: OAuthTokens }>;
    revokeToken(token: string): Promise<unknown>;
    refreshAccessToken(): Promise<{ credentials: OAuthTokens }>;
    setCredentials(credentials: Record<string, string>): void;
  }

  type CalendarClient = {
    events: {
      insert(options: Record<string, unknown>): Promise<CalendarResponse>;
      patch(options: Record<string, unknown>): Promise<CalendarResponse>;
      delete(options: Record<string, unknown>): Promise<unknown>;
      list(options: Record<string, unknown>): Promise<CalendarResponse>;
    };
  };

  export const google: {
    auth: {
      OAuth2: typeof OAuth2;
    };
    calendar(options: { version: string; auth: OAuth2 }): CalendarClient;
  };
}