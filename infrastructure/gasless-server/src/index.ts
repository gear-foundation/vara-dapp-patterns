import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import dotenv from "dotenv";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import { HexString } from "@gear-js/api";
import { GaslessService } from "./lib";

dotenv.config();

async function main() {
  // Polkadot cryptographic primitives must be initialized before any
  // key or signature operation can be performed.
  await cryptoWaitReady();

  const app = express();
  app.use(cors());
  app.use(bodyParser.json());

  const gaslessService = new GaslessService();

  // The program ID to which all vouchers issued by this server are scoped.
  // A voucher is only valid for calls that target this program.
  const programId = process.env.PROGRAM_ID as HexString;
  if (!programId) throw new Error("Missing PROGRAM_ID env var");

  // ─── Health ───────────────────────────────────────────────────────────────

  app.get("/health", (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  // ─── Request a voucher ────────────────────────────────────────────────────
  //
  // Issues a new gasless voucher for `account`, scoped to the server's PROGRAM_ID.
  //
  // Body: { account: HexString, amount?: number, durationInSec?: number }
  // Response: { voucherId: HexString }
  app.post("/gasless/voucher/request", async (req, res) => {
    const { account, amount = 20_000_000_000_000, durationInSec = 3_600 } =
      req.body;

    if (!account) {
      return res.status(400).json({ error: "account is required" });
    }

    try {
      const voucherId: HexString = await gaslessService.issueIfNeeded(
        account,
        programId,
        amount,
        Number(durationInSec)
      );

      console.log("[server] ✅ Voucher created:", voucherId);
      return res.status(200).json({ voucherId });
    } catch (error) {
      console.error("[server] ❌ Error creating voucher:", error);
      return res.status(500).json({
        error: "Failed to create voucher",
        details:
          error instanceof Error ? error.message : String(error),
      });
    }
  });

  // ─── Voucher status ───────────────────────────────────────────────────────
  //
  // Checks whether a voucher is active and returns its balance.
  //
  // Params: voucherId (HexString, may omit leading 0x — the server normalizes it)
  // Response: { enabled: boolean, exists: boolean, rawBalance?: string }
  app.get("/gasless/voucher/:voucherId/status", async (req, res) => {
    const { voucherId } = req.params;

    // Normalize: ensure the id always starts with 0x
    const normalizedId = voucherId.startsWith("0x")
      ? (voucherId as `0x${string}`)
      : (`0x${voucherId}` as `0x${string}`);

    try {
      const status = await gaslessService.getVoucherStatus(normalizedId);
      return res.json(status);
    } catch (err) {
      console.error("[server] Error getting voucher status:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── Legacy: /issue ───────────────────────────────────────────────────────
  //
  // Alias kept for backward compatibility with older frontend integrations.
  // Prefer /gasless/voucher/request for new integrations.
  app.post("/issue", async (req, res) => {
    const { account, amount, durationInSec } = req.body;

    const spender =
      typeof account === "string" ? account : String(account);

    if (!spender.startsWith("0x") || spender.length !== 66) {
      return res
        .status(400)
        .json({ error: `Invalid account format: ${spender}` });
    }

    try {
      const voucher = await gaslessService.issue(
        spender as HexString,
        programId,
        amount,
        Number(durationInSec)
      );
      return res.json({ voucherId: voucher });
    } catch (error) {
      console.error("[server] Error in /issue:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── Prolong a voucher ────────────────────────────────────────────────────
  //
  // Extends the balance and/or duration of an existing voucher.
  //
  // Body: { voucherId: HexString, account: string, balance: number, durationInSec: number }
  app.post("/prolong", async (req, res) => {
    const { voucherId, account, balance, durationInSec } = req.body;

    try {
      await gaslessService.prolong(voucherId, account, balance, durationInSec);
      return res.sendStatus(200);
    } catch (error) {
      console.error("[server] Error in /prolong:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── Revoke a voucher ─────────────────────────────────────────────────────
  //
  // Revokes an existing voucher and returns its remaining funds to the issuer.
  //
  // Body: { voucherId: HexString, account: string }
  app.post("/revoke", async (req, res) => {
    const { voucherId, account } = req.body;

    try {
      await gaslessService.revoke(voucherId, account);
      return res.sendStatus(200);
    } catch (error) {
      console.error("[server] Error in /revoke:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── Start ────────────────────────────────────────────────────────────────

  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`🚀 Gasless server running on port ${port}`);
    console.log(`   Program ID: ${programId}`);
  });
}

main().catch((err) => {
  console.error("[server] Fatal error on startup:", err);
  process.exit(1);
});
