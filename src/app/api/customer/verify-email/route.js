// ADDON: saas-mt — Email verification (OTP code)
// POST with {action: "send"} → send/resend OTP code
// POST with {action: "verify", code: "123456"} → verify OTP
import { NextResponse } from "next/server";
import crypto from "crypto";
import { getCustomerFromRequest } from "@/lib/customer/session";
import { getCustomerById, updateCustomer } from "@/lib/db";
import { rateLimit, getClientIp } from "@/lib/customer/rateLimit";

const otpLimiter = rateLimit({ windowMs: 15 * 60_000, max: 10, message: "Terlalu banyak percobaan. Coba lagi nanti." });

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function generateOtp() {
  return crypto.randomInt(100000, 999999).toString();
}

export async function POST(request) {
  const rl = otpLimiter.check(getClientIp(request));
  if (!rl.ok) return NextResponse.json({ error: rl.message }, { status: 429 });

  const customer = await getCustomerFromRequest(request);
  if (!customer) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (customer.emailVerified) {
    return NextResponse.json({ error: "Email sudah terverifikasi", verified: true });
  }

  let body;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { action, code } = body;

  if (action === "send") {
    const otp = generateOtp();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

    // Store OTP in metadata
    const meta = customer.metadata || {};
    meta.verificationOtp = { code: otp, expiresAt, attempts: 0 };
    await updateCustomer(customer.id, { metadata: meta });

    // Try to send via email
    const emailSent = await sendOtpEmail(customer.email, otp);

    if (emailSent) {
      return NextResponse.json({
        sent: true,
        message: `Kode verifikasi dikirim ke ${maskEmail(customer.email)}`,
      });
    }

    // Fallback: notify admin via Telegram to relay the code
    await notifyAdminOtp(customer.email, otp);

    return NextResponse.json({
      sent: true,
      message: `Kode verifikasi dikirim ke ${maskEmail(customer.email)}. Cek email atau hubungi admin.`,
    });
  }

  if (action === "verify") {
    if (!code || code.length !== 6) {
      return NextResponse.json({ error: "Kode harus 6 digit" }, { status: 400 });
    }

    const meta = customer.metadata || {};
    const otp = meta.verificationOtp;

    if (!otp || !otp.code) {
      return NextResponse.json({ error: "Belum ada kode. Kirim kode dulu." }, { status: 400 });
    }

    if (new Date(otp.expiresAt) < new Date()) {
      return NextResponse.json({ error: "Kode sudah expired. Kirim ulang." }, { status: 400 });
    }

    if (otp.attempts >= 5) {
      return NextResponse.json({ error: "Terlalu banyak percobaan. Kirim ulang kode." }, { status: 400 });
    }

    if (code !== otp.code) {
      // Increment attempts
      otp.attempts = (otp.attempts || 0) + 1;
      meta.verificationOtp = otp;
      await updateCustomer(customer.id, { metadata: meta });
      return NextResponse.json({ error: "Kode salah" }, { status: 400 });
    }

    // Success — mark as verified
    delete meta.verificationOtp;
    await updateCustomer(customer.id, { emailVerified: true, metadata: meta });

    return NextResponse.json({ verified: true, message: "Email berhasil diverifikasi!" });
  }

  return NextResponse.json({ error: "action harus 'send' atau 'verify'" }, { status: 400 });
}

function maskEmail(email) {
  const [user, domain] = email.split("@");
  if (user.length <= 2) return `${user[0]}***@${domain}`;
  return `${user[0]}${user[1]}***@${domain}`;
}

async function sendOtpEmail(email, otp) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) return false;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${resendKey}`,
      },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || "Cortex AI <noreply@cortex-ai.my.id>",
        to: [email],
        subject: `Kode Verifikasi Cortex AI: ${otp}`,
        html: `
          <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 20px;">
            <h2 style="color: #f97815;">Cortex AI</h2>
            <p>Kode verifikasi kamu:</p>
            <div style="background: #f5f5f5; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
              <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #333;">${otp}</span>
            </div>
            <p style="color: #666; font-size: 14px;">Kode ini berlaku 10 menit. Jangan berikan kode ini ke siapapun.</p>
          </div>
        `,
      }),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function notifyAdminOtp(email, otp) {
  const token = process.env.ADMIN_TG_BOT_TOKEN;
  const chatId = process.env.ADMIN_TG_CHAT_ID;
  if (!token || !chatId) return;
  const msg = `*Verifikasi Email*\n\nEmail: \`${email}\`\nKode OTP: \`${otp}\`\n\n_Relay kode ini ke customer jika email tidak terkirim_`;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: "Markdown" }),
    signal: AbortSignal.timeout(10000),
  }).catch(() => {});
}
