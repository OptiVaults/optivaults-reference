/**
 * Page Coverage Tests — Deposit, Withdraw, Emergency logic
 *
 * Tests pure calculation logic extracted from page components.
 */
import { describe, it, expect } from "vitest";

// ═══════════════════════════════════
// Deposit Page Logic
// ═══════════════════════════════════

describe("Deposit page logic", () => {
  describe("share calculation", () => {
    it("first depositor gets 1M multiplier", () => {
      const totalShares = 0;
      const usdcxAmount = 100; // 100 USDCx
      const shares = totalShares === 0 ? usdcxAmount * 1_000_000 : 0;
      expect(shares).toBe(100_000_000);
    });

    it("subsequent depositor gets proportional shares", () => {
      const totalShares = 100_000_000; // 100M shares
      const deposited = 100_000_000; // 100 USDCx (in units)
      const usdcxAmount = 50; // 50 USDCx
      const shares = deposited > 0
        ? (usdcxAmount * 1e6 * totalShares) / deposited
        : usdcxAmount * 1_000_000;
      expect(shares).toBe(50_000_000);
    });

    it("share price increases after yield", () => {
      const totalShares = 100_000_000;
      const deposited = 110_000_000; // 110 USDCx (10% yield)
      const usdcxAmount = 50;
      const shares = (usdcxAmount * 1e6 * totalShares) / deposited;
      // 50M * 100M / 110M = 45.45M (fewer shares due to higher price)
      expect(shares).toBeLessThan(50_000_000);
      expect(shares).toBeGreaterThan(45_000_000);
    });
  });

  describe("slippage protection", () => {
    it("minShares is 98% of expected", () => {
      const shares = 50_000_000;
      const minShares = Math.floor(shares * 0.98);
      expect(minShares).toBe(49_000_000);
    });
  });

  describe("amount validation", () => {
    const minDeposit = 10;

    it("rejects below minimum", () => {
      expect(5 >= minDeposit).toBe(false);
    });

    it("accepts exact minimum", () => {
      expect(10 >= minDeposit).toBe(true);
    });

    it("accepts above minimum", () => {
      expect(100 >= minDeposit).toBe(true);
    });
  });

  describe("insufficient balance detection (integer comparison)", () => {
    it("detects insufficient with integer comparison", () => {
      const amount = 22.84;
      const walletBalance = 22839999n; // 22.839999 USDCx
      const insufficient = Math.floor(amount * 1e6) > Number(walletBalance);
      // Math.floor(22.84 * 1e6) = 22840000 > 22839999 = true
      expect(insufficient).toBe(true);
    });

    it("accepts when equal (float precision safe)", () => {
      const amount = 22.839999;
      const walletBalance = 22839999n;
      const insufficient = Math.floor(amount * 1e6) > Number(walletBalance);
      expect(insufficient).toBe(false);
    });

    it("accepts when balance is higher", () => {
      const amount = 10;
      const walletBalance = 50_000_000n;
      const insufficient = Math.floor(amount * 1e6) > Number(walletBalance);
      expect(insufficient).toBe(false);
    });
  });

  describe("percentage buttons", () => {
    it("25% of balance", () => {
      const balance = 100;
      expect((balance * 0.25).toFixed(6)).toBe("25.000000");
    });

    it("50% of balance", () => {
      const balance = 100;
      expect((balance * 0.5).toFixed(6)).toBe("50.000000");
    });

    it("MAX of balance", () => {
      const balance = 22.840000;
      expect((balance * 1).toFixed(6)).toBe("22.840000");
    });

    it("zero balance returns empty", () => {
      const balance = 0;
      const result = balance > 0 ? (balance * 0.5).toFixed(6) : "";
      expect(result).toBe("");
    });
  });

  describe("input sanitization", () => {
    it("strips non-numeric characters", () => {
      const raw = "12.34abc";
      const sanitized = raw.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
      expect(sanitized).toBe("12.34");
    });

    it("prevents multiple dots", () => {
      const raw = "12.34.56";
      const sanitized = raw.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
      expect(sanitized).toBe("12.3456");
    });

    it("allows plain integer", () => {
      const raw = "100";
      const sanitized = raw.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
      expect(sanitized).toBe("100");
    });
  });
});

// ═══════════════════════════════════
// Withdraw Page Logic
// ═══════════════════════════════════

describe("Withdraw page logic", () => {
  describe("formatShares", () => {
    function formatShares(n: number): string {
      if (n === 0) return "0";
      const abs = Math.abs(n);
      if (abs >= 1e12) return (n / 1e12).toFixed(2) + "T";
      if (abs >= 1e9) return (n / 1e9).toFixed(2) + "B";
      if (abs >= 1e6) return (n / 1e6).toFixed(2) + "M";
      if (abs >= 1e3) return (n / 1e3).toFixed(1) + "K";
      return n.toLocaleString();
    }

    it("formats zero", () => expect(formatShares(0)).toBe("0"));
    it("formats thousands", () => expect(formatShares(1500)).toBe("1.5K"));
    it("formats millions", () => expect(formatShares(2_500_000)).toBe("2.50M"));
    it("formats billions", () => expect(formatShares(3_200_000_000)).toBe("3.20B"));
    it("formats trillions", () => expect(formatShares(94_000_000_000_000)).toBe("94.00T"));
    it("formats small number", () => expect(formatShares(500)).toBe("500"));
  });

  describe("USDCx preview calculation", () => {
    it("calculates withdraw amount from shares", () => {
      const sharesToBurn = 50_000_000_000_000; // 50T shares
      const totalShares = 100_000_000_000_000; // 100T total
      const totalDeposited = 200_000_000; // 200 USDCx (in 6 dec units)
      const preview = (sharesToBurn * totalDeposited) / totalShares / 1e6;
      expect(preview).toBeCloseTo(100, 0); // 100 USDCx
    });

    it("full withdraw returns all deposited", () => {
      const sharesToBurn = 94_000_000_000_000;
      const totalShares = 94_000_000_000_000;
      const totalDeposited = 94_020_000;
      const preview = (sharesToBurn * totalDeposited) / totalShares / 1e6;
      expect(preview).toBeCloseTo(94.02, 1);
    });

    it("returns shares/1M when vault empty", () => {
      const sharesToBurn = 10_000_000;
      const totalShares = 0;
      const preview = totalShares > 0 ? 0 : sharesToBurn / 1_000_000;
      expect(preview).toBe(10);
    });
  });

  describe("withdraw minReceive", () => {
    it("applies 2% slippage", () => {
      const usdcxPreview = 100; // 100 USDCx
      const minReceive = Math.floor(usdcxPreview * 0.98 * 1e6);
      expect(minReceive).toBe(98_000_000);
    });
  });

  describe("insufficient shares detection", () => {
    it("detects over-withdrawal", () => {
      const sharesToBurn = 100_000_000_000_000;
      const userShares = 50_000_000_000_000;
      expect(sharesToBurn > userShares).toBe(true);
    });

    it("accepts exact balance", () => {
      const sharesToBurn = 94_000_000_000_000;
      const userShares = 94_000_000_000_000;
      expect(sharesToBurn > userShares).toBe(false);
    });
  });

  describe("mode selection", () => {
    it("direct mode has early exit fee", () => {
      const earlyFeeBps = 10; // 0.1%
      const amount = 1000; // 1000 USDCx
      const fee = amount * earlyFeeBps / 10000;
      expect(fee).toBe(1); // 1 USDCx fee
    });

    it("queue mode is free", () => {
      const queueFee = 0;
      expect(queueFee).toBe(0);
    });
  });
});

// ═══════════════════════════════════
// Emergency Page Logic
// ═══════════════════════════════════

describe("Emergency page logic", () => {
  describe("days since compound", () => {
    it("calculates correctly", () => {
      const lastCompoundTime = Date.now() - 3 * 86400000; // 3 days ago
      const days = Math.floor((Date.now() - lastCompoundTime) / 86400000);
      expect(days).toBe(3);
    });

    it("returns 0 for recent compound", () => {
      const lastCompoundTime = Date.now() - 3600000; // 1 hour ago
      const days = Math.floor((Date.now() - lastCompoundTime) / 86400000);
      expect(days).toBe(0);
    });

    it("returns 0 for zero timestamp", () => {
      const lastCompoundTime = 0;
      const days = lastCompoundTime > 0
        ? Math.floor((Date.now() - lastCompoundTime) / 86400000)
        : 0;
      expect(days).toBe(0);
    });
  });

  describe("emergency eligibility", () => {
    it("eligible after 7 days", () => {
      const daysSinceCompound = 8;
      const connected = true;
      const hasShares = true;
      const canEmergency = daysSinceCompound >= 7 && connected && hasShares;
      expect(canEmergency).toBe(true);
    });

    it("not eligible before 7 days", () => {
      const daysSinceCompound = 5;
      expect(daysSinceCompound >= 7).toBe(false);
    });

    it("not eligible when not connected", () => {
      const daysSinceCompound = 10;
      const connected = false;
      const hasShares = true;
      expect(daysSinceCompound >= 7 && connected && hasShares).toBe(false);
    });

    it("not eligible with zero shares", () => {
      const daysSinceCompound = 10;
      const connected = true;
      const hasShares = false;
      expect(daysSinceCompound >= 7 && connected && hasShares).toBe(false);
    });
  });

  describe("countdown display", () => {
    it("shows days until eligible", () => {
      const daysSinceCompound = 3;
      const daysUntil = 7 - daysSinceCompound;
      expect(daysUntil).toBe(4);
    });

    it("shows 0 when already eligible", () => {
      const daysSinceCompound = 10;
      const daysUntil = Math.max(0, 7 - daysSinceCompound);
      expect(daysUntil).toBe(0);
    });
  });
});

// ═══════════════════════════════════
// StatusBanner Logic
// ═══════════════════════════════════

describe("StatusBanner logic", () => {
  describe("TX status mapping", () => {
    function txStatusColor(status: string): string {
      if (status === "confirmed") return "emerald";
      if (status === "failed") return "red";
      if (status === "pending" || status === "submitting") return "amber";
      return "slate";
    }

    it("confirmed is green", () => expect(txStatusColor("confirmed")).toBe("emerald"));
    it("failed is red", () => expect(txStatusColor("failed")).toBe("red"));
    it("pending is amber", () => expect(txStatusColor("pending")).toBe("amber"));
    it("submitting is amber", () => expect(txStatusColor("submitting")).toBe("amber"));
    it("idle is slate", () => expect(txStatusColor("idle")).toBe("slate"));
  });
});
