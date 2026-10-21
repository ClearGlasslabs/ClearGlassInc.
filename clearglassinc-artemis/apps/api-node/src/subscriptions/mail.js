import nodemailer from "nodemailer";

/** Transactional email over SMTP. Returns null when SMTP is not configured (login then fails closed). */
export function createMailer(smtp) {
  if (!smtp) return null;
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    requireTLS: !smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
  });
  return {
    send: ({ to, subject, text }) => transport.sendMail({ from: smtp.from, to, subject, text }),
  };
}

export function loginEmail({ link, ttlMinutes }) {
  return {
    subject: "Your ClearGlassInc sign-in link",
    text: [
      "Use this link to sign in to your ClearGlassInc membership account:",
      "",
      link,
      "",
      `The link works once and expires in ${ttlMinutes} minutes. If you did not request it, you can ignore this message.`,
    ].join("\n"),
  };
}
