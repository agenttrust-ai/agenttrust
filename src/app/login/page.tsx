"use client";

import { useActionState } from "react";
import Link from "next/link";
import { login } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { FormError, TextField } from "@/components/ui/text-field";

export default function LoginPage() {
  const [state, action, pending] = useActionState(login, undefined);

  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-16 sm:px-6 sm:py-24">
      <div>
        <h1 className="text-title">Log in</h1>
        <p className="mt-1.5 text-sm text-muted">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-accent hover:underline">
            Sign up
          </Link>
        </p>
      </div>
      <form action={action} className="flex flex-col gap-4">
        <TextField
          id="email"
          name="email"
          type="email"
          label="Email"
          required
          autoComplete="email"
          error={state?.errors?.email?.[0]}
        />
        <TextField
          id="password"
          name="password"
          type="password"
          label="Password"
          required
          autoComplete="current-password"
          error={state?.errors?.password?.[0]}
        />
        {state?.message && <FormError>{state.message}</FormError>}
        <Button type="submit" size="lg" disabled={pending} className="mt-2">
          {pending ? "Logging in…" : "Log in"}
        </Button>
      </form>
    </div>
  );
}
