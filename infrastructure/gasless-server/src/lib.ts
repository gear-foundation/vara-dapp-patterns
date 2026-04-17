import { GearApi, HexString, IUpdateVoucherParams } from "@gear-js/api";
import { waitReady } from "@polkadot/wasm-crypto";
import { hexToU8a } from "@polkadot/util";
import { Keyring } from "@polkadot/api";

/// How many wall-clock seconds a single Vara block represents.
/// Used to convert a duration in seconds to a duration in blocks.
const SECONDS_PER_BLOCK = 3;

/// In-memory cache of voucher metadata keyed by voucher id.
/// Stores the original `amount` and `durationInSec` used at issue time,
/// so we can answer info queries without additional on-chain round-trips.
const voucherInfoStorage: Record<HexString, VoucherInfo> = {};

type VoucherIssueKey = `${HexString}:${HexString}`;

type VoucherInfo = {
  durationInSec: number;
  amount: number;
};

export interface IVoucherDetails {
  id: HexString;
  enabled: boolean;
  varaToIssue: number;
  duration: number;
}

/// GaslessService
///
/// Manages the lifecycle of Vara vouchers on behalf of user accounts.
/// A voucher is an on-chain escrow that allows a designated `spender`
/// to pay transaction fees for a specific set of programs without holding
/// VARA themselves.
///
/// This service holds the private key of a "voucher issuer" account that
/// covers the cost of issuing, prolonging, and revoking vouchers.
export class GaslessService {
  private api: GearApi;
  private readonly voucherAccount: ReturnType<Keyring["addFromSeed"]>;
  private submissionQueue: Promise<void> = Promise.resolve();
  private readonly inFlightVoucherIssues = new Map<VoucherIssueKey, Promise<HexString>>();

  constructor() {
    this.api = new GearApi({ providerAddress: process.env.NODE_URL });
    this.voucherAccount = this.getVoucherAccount();
  }

  /// Issue a voucher only if no active voucher already exists for the
  /// given account + programId combination. Avoids duplicate issuance
  /// when a frontend calls this on every page load.
  async issueIfNeeded(
    account: HexString,
    programId: HexString,
    amount: number,
    durationInSec: number
  ): Promise<HexString> {
    const key: VoucherIssueKey = `${account}:${programId}`;
    const inFlight = this.inFlightVoucherIssues.get(key);
    if (inFlight) return inFlight;

    const request = this.enqueueIssuerOperation(async () => {
      await Promise.all([this.api.isReadyOrError, waitReady()]);

      // Check whether this account already has a voucher scoped to programId.
      const all = await this.api.voucher.getAllForAccount(account);
      const existing = Object.entries(all).find(
        ([, v]) => Array.isArray(v.programs) && v.programs.includes(programId)
      );

      if (existing) {
        console.log("⚠️ Voucher already exists:", existing[0]);
        return existing[0] as HexString;
      }

      return this.issueInternal(account, programId, amount, durationInSec);
    });

    this.inFlightVoucherIssues.set(key, request);

    try {
      return await request;
    } finally {
      this.inFlightVoucherIssues.delete(key);
    }
  }

  /// Return full voucher details (id, enabled, varaToIssue, duration) for the
  /// first voucher found that covers `programId` for the given account.
  async getVoucherDetailsForProgram(
    account: string,
    programId: HexString
  ): Promise<IVoucherDetails> {
    const vouchersRecord = await this.api.voucher.getAllForAccount(account);

    for (const [voucherIdHex, details] of Object.entries(vouchersRecord)) {
      if (
        Array.isArray(details.programs) &&
        details.programs.includes(programId)
      ) {
        const voucherId = voucherIdHex as HexString;
        const status = await this.getVoucherStatus(voucherId);

        if (!status.exists) {
          throw new Error("Voucher exists in index but is not valid on-chain");
        }

        const info = await this.getVoucherInfo(voucherId);

        return {
          id: voucherId,
          enabled: status.enabled,
          varaToIssue: info.amount,
          duration: info.durationInSec,
        };
      }
    }

    throw new Error("No voucher found for this account and program");
  }

  /// Retrieve cached voucher info (amount + duration) for a given voucher id.
  /// Falls back to querying the on-chain balance if not cached.
  public async getVoucherInfo(voucherId: HexString): Promise<{
    durationInSec: number;
    amount: number;
  }> {
    const stored = voucherInfoStorage[voucherId];
    if (stored) return stored;

    const info = await this.api.balance.findOut(voucherId);
    return {
      durationInSec: 3600,
      amount: info.toBn().toNumber(),
    };
  }

  /// Query whether a voucher account has funds and is considered active.
  /// Returns `{ enabled, exists, rawBalance? }`.
  public async getVoucherStatus(voucherId: HexString): Promise<{
    enabled: boolean;
    exists: boolean;
    rawBalance?: string;
  }> {
    try {
      const info = await this.api.balance.findOut(voucherId);

      const issuerInfo = await this.api.balance.findOut(
        this.voucherAccount.address
      );
      console.log(
        `[GaslessService] Issuer balance: ${issuerInfo.toHuman()} | Voucher: ${this.voucherAccount.address}`
      );

      return {
        enabled: true,
        exists: true,
        rawBalance: info.toHuman(),
      };
    } catch (error) {
      console.warn("[GaslessService] ⚠️ Failed to find voucher:", error);
      return { enabled: false, exists: false };
    }
  }

  /// Issue a new voucher for `spender` scoped to `programId`.
  ///
  /// The voucher issuer account signs and submits the extrinsic.
  /// Resolution waits for the `VoucherIssued` event to appear in the block.
  ///
  /// Two failure phases exist:
  /// 1. Before `signAndSend` — runtime rejects the request (bad params, insufficient issuer balance).
  /// 2. Inside the status callback — `ExtrinsicFailed` event received instead of `VoucherIssued`.
  public async issue(
    spender: HexString,
    programId: HexString,
    amount: number,
    durationInSec: number
  ): Promise<HexString> {
    return this.enqueueIssuerOperation(() =>
      this.issueInternal(spender, programId, amount, durationInSec)
    );
  }

  private async issueInternal(
    spender: HexString,
    programId: HexString,
    amount: number,
    durationInSec: number
  ): Promise<HexString> {
    await Promise.all([this.api.isReadyOrError, waitReady()]);

    const durationInBlocks = Math.round(durationInSec / SECONDS_PER_BLOCK);
    const accountId = this.api.createType("AccountId32", spender).toHex();

    const { extrinsic } = await this.api.voucher.issue(
      accountId,
      amount,
      durationInBlocks,
      [programId],
      false // transferable: false — voucher is non-transferable
    );

    const issuerBalance = await this.api.balance.findOut(
      this.voucherAccount.address
    );
    console.log(
      `[GaslessService] Issuer balance before issue: ${issuerBalance.toHuman()}`
    );

    const nonce = await this.api.rpc.system.accountNextIndex(
      this.voucherAccount.address
    );

    const voucherId = await new Promise<HexString>((resolve, reject) => {
      extrinsic.signAndSend(
        this.voucherAccount,
        { nonce },
        ({ events, status }) => {
          if (!status.isInBlock) return;

          // Success path: VoucherIssued event emitted
          const viEvent = events.find(
            ({ event }) => event.method === "VoucherIssued"
          );

          if (viEvent) {
            const data = viEvent.event.data as any;
            const id = data.voucherId.toHex() as HexString;
            // Cache metadata for future info queries
            voucherInfoStorage[id] = { durationInSec, amount };
            resolve(id);
            return;
          }

          // Failure path: ExtrinsicFailed event emitted
          const efEvent = events.find(
            ({ event }) => event.method === "ExtrinsicFailed"
          );
          console.error(
            "[GaslessService] ❌ ExtrinsicFailed:",
            efEvent?.event.toHuman()
          );
          reject(
            efEvent
              ? this.api.getExtrinsicFailedError(efEvent.event)
              : new Error("VoucherIssued event not found in block")
          );
        }
      );
    });

    console.log("[GaslessService] ✅ Voucher issued:", voucherId);
    return voucherId;
  }

  /// Prolong an existing voucher by increasing its balance and/or extending its duration.
  ///
  /// `balance` is the desired final balance in planck.
  /// `prolongDurationInSec` is the number of additional seconds to add.
  public async prolong(
    voucherId: HexString,
    account: string,
    balance: number,
    prolongDurationInSec: number
  ): Promise<void> {
    await this.enqueueIssuerOperation(async () => {
      const currentBalance =
        (await this.api.balance.findOut(voucherId)).toBigInt() / BigInt(1e12);
      const durationInBlocks = Math.round(prolongDurationInSec / SECONDS_PER_BLOCK);
      const topUp = BigInt(balance) - currentBalance;

      const params: IUpdateVoucherParams = {};
      if (prolongDurationInSec > 0) {
        params.prolongDuration = durationInBlocks;
      }
      if (topUp > 0n) {
        params.balanceTopUp = topUp * BigInt(1e12);
      }

      const tx = this.api.voucher.update(account, voucherId, params);
      await this.signQueuedTx(tx, "VoucherUpdated");
    });
  }

  /// Revoke a voucher, returning its remaining funds to the issuer account.
  public async revoke(voucherId: HexString, account: string): Promise<void> {
    await this.enqueueIssuerOperation(async () => {
      const tx = this.api.voucher.revoke(account, voucherId);
      await this.signQueuedTx(tx, "VoucherRevoked");
    });
  }

  /// Return all vouchers for the given account address.
  async getVouchersForAccount(account: string) {
    return this.api.voucher.getAllForAccount(account);
  }

  /// Load the voucher issuer keypair from the hex-encoded seed stored in VOUCHER_ACCOUNT_SEED_HEX.
  /// The account must hold enough VARA to cover the cost of all vouchers it issues.
  private getVoucherAccount() {
    const seed = process.env.VOUCHER_ACCOUNT_SEED_HEX;
    if (!seed) throw new Error("Missing VOUCHER_ACCOUNT_SEED_HEX env var");
    const keyring = new Keyring({ type: "sr25519", ss58Format: 137 });
    return keyring.addFromSeed(hexToU8a(seed));
  }

  private enqueueIssuerOperation<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.submissionQueue.then(operation);
    this.submissionQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async signQueuedTx(
    tx: any,
    successEventMethod: string
  ): Promise<void> {
    const nonce = await this.api.rpc.system.accountNextIndex(
      this.voucherAccount.address
    );

    await new Promise<void>((resolve, reject) => {
      tx.signAndSend(this.voucherAccount, { nonce }, ({ events, status }: { events: any[]; status: { isInBlock: boolean } }) => {
        if (!status.isInBlock) return;

        const successEvent = events.find(
          ({ event }: { event: any }) => event.method === successEventMethod
        );
        if (successEvent) return resolve();

        const failedEvent = events.find(
          ({ event }: { event: any }) => event.method === "ExtrinsicFailed"
        );
        reject(
          failedEvent
            ? this.api.getExtrinsicFailedError(failedEvent.event)
            : new Error(`${successEventMethod} event not found in block`)
        );
      });
    });
  }
}
