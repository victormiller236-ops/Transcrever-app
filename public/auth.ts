import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Credentials({
      credentials: { password: { label: "Senha", type: "password" } },
      authorize(credentials) {
        if (
          typeof credentials?.password === "string" &&
          credentials.password.length > 0 &&
          credentials.password === process.env.APP_PASSWORD
        ) {
          return { id: "owner", name: "Você" };
        }
        return null;
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  trustHost: true,
  secret: process.env.AUTH_SECRET,
});
