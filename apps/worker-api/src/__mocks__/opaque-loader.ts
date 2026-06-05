// Mock OPAQUE loader for tests

export interface OpaqueServer {
  createSetup(): string;
  createRegistrationResponse(params: {
    serverSetup: string;
    userIdentifier: string;
    registrationRequest: string;
  }): { registrationResponse: string };
  startLogin(params: {
    serverSetup: string;
    registrationRecord: string;
    startLoginRequest: string;
    userIdentifier: string;
    identifiers: { client: string; server: string };
  }): { serverLoginState: string; loginResponse: string };
  finishLogin(params: {
    serverLoginState: string;
    finishLoginRequest: string;
    identifiers: { client: string; server: string };
  }): void;
  getPublicKey(data: string): string;
}

const mockOpaqueServer: OpaqueServer = {
  createSetup: () => "mock-server-setup",
  createRegistrationResponse: (params) => ({
    registrationResponse: `mock-registration-response-for-${params.userIdentifier}`,
  }),
  startLogin: (params) => ({
    serverLoginState: `mock-server-login-state-${Date.now()}`,
    loginResponse: `mock-login-response-for-${params.userIdentifier}`,
  }),
  finishLogin: () => {},
  getPublicKey: (data) => `mock-public-key-for-${data}`,
};

export const ready = Promise.resolve();

export async function getOpaqueServer(): Promise<OpaqueServer> {
  return mockOpaqueServer;
}
