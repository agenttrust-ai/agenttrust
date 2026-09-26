"use client";

import { useActionState } from "react";
import Link from "next/link";
import { signup } from "@/lib/auth/actions";
import { Button } from "@/components/ui/button";
import { IconInfo } from "@/components/ui/icons";
import { FormError, TextField } from "@/components/ui/text-field";

export default function SignupPage() {
  const [state, action, pending] = useActionState(signup, undefined);

  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-16 sm:px-6 sm:py-24">
      <div>
        <h1 className="text-title">Create an account</h1>
        <p className="mt-1.5 text-sm text-muted">
          Already have one?{" "}
          <Link href="/login" className="text-accent hover:underline">
            Log in
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
          autoComplete="new-password"
          hint="At least 8 characters."
          error={state?.errors?.password?.[0]}
        />
        {state?.message &&
          (state.errors ? (
            <FormError>{state.message}</FormError>
          ) : (
            <p
              role="status"
              className="flex items-start gap-2 rounded-md border border-info-border bg-info-surface px-3 py-2 text-sm text-info"
            >
              <IconInfo className="mt-0.5 size-4 shrink-0" />
              <span>{state.message}</span>
            </p>
          ))}
        <Button type="submit" size="lg" disabled={pending} className="mt-2">
          {pending ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </div>
  );
}
