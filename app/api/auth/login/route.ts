import bcrypt from "bcryptjs";
import { z } from "zod";
import { query } from "@/lib/db";
import { setSessionCookie, jsonError } from "@/lib/auth";
import { assertRateLimit, assertSameOrigin } from "@/lib/request-guards";

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    assertRateLimit(request, { key: "auth-login", limit: 10, windowMs: 60_000 });
    const body = LoginSchema.parse(await request.json());
    const result = await query<{
      id: number;
      name: string;
      email: string;
      password_hash: string;
      role: "admin" | "user";
    }>("SELECT id, name, email, password_hash, role FROM users WHERE email = LOWER($1) AND is_active = TRUE", [
      body.email,
    ]);

    const record = result.rows[0];
    if (!record || !(await bcrypt.compare(body.password, record.password_hash))) {
      return Response.json({ error: "Invalid email or password" }, { status: 401 });
    }

    const user = { id: record.id, name: record.name, email: record.email, role: record.role };
    await setSessionCookie(user);
    return Response.json({ user });
  } catch (error) {
    return jsonError(error);
  }
}
