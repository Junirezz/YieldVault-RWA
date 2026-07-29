declare module '@stellar/stellar-sdk' {
  export interface Account {
    accountId(): string;
    sequenceNumber(): string;
    incrementSequenceNumber(): void;
  }

  export const BASE_FEE: string;

  export class Keypair {
    static fromSecret(secret: string): Keypair;
    static random(): Keypair;
    publicKey(): string;
    sign(data: Buffer): Buffer;
  }

  export class Contract {
    constructor(contractId: string);
    call(method: string, ...args: unknown[]): unknown;
  }

  /**
   * The `rpc` namespace reflects the actual runtime structure of
   * `@stellar/stellar-sdk` v13 (exported as `sdk.rpc.*`).
   * Previously declared as `SorobanRpc` — corrected as part of issue #438.
   */
  export namespace rpc {
    namespace Api {
      function isSimulationError(input: unknown): boolean;
      function isSimulationRestore(input: unknown): boolean;
      interface SimulateTransactionSuccessResponse {
        result?: {
          retval?: unknown;
        };
      }
    }

    function assembleTransaction(tx: unknown, sim: unknown): { build(): { sign(kp: Keypair): void } };

    class Server {
      constructor(url: string);
      getAccount(accountId: string): Promise<any>;
      simulateTransaction(tx: unknown): Promise<any>;
      sendTransaction(tx: unknown): Promise<{ status: string; hash: string; errorResult?: any }>;
      getTransaction(hash: string): Promise<any>;
    }
  }

  export function nativeToScVal(value: unknown, options?: unknown): unknown;

  export namespace StrKey {
    function isValidEd25519PublicKey(value: string): boolean;
  }

  export class TransactionBuilder {
    constructor(source: Account, opts: unknown);
    addOperation(op: unknown): TransactionBuilder;
    setTimeout(timeout: number): TransactionBuilder;
    build(): unknown;
  }
}
