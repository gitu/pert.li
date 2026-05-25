import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { authClient } from "#/lib/auth-client";

export const Route = createFileRoute("/signin")({
	component: SignInPage,
});

function SignInPage() {
	const navigate = useNavigate();
	const [mode, setMode] = useState<"signin" | "signup">("signin");
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [pending, setPending] = useState(false);

	async function onSubmit(event: React.FormEvent) {
		event.preventDefault();
		setError(null);
		setPending(true);
		try {
			const result =
				mode === "signin"
					? await authClient.signIn.email({ email, password })
					: await authClient.signUp.email({ name, email, password });
			if (result.error) {
				setError(result.error.message ?? "Something went wrong");
				return;
			}
			navigate({ to: "/" });
		} catch (err) {
			setError(err instanceof Error ? err.message : "Unexpected error");
		} finally {
			setPending(false);
		}
	}

	return (
		<div className="min-h-svh grid place-items-center bg-background p-6">
			<form
				onSubmit={onSubmit}
				className="w-full max-w-sm space-y-5 rounded-lg border bg-card p-6 shadow-sm"
			>
				<div className="space-y-1">
					<h1 className="text-xl font-semibold tracking-tight">
						{mode === "signin" ? "Sign in" : "Create an account"}
					</h1>
					<p className="text-sm text-muted-foreground">
						{mode === "signin"
							? "Welcome back to pert.li."
							: "Pick a name and an email to get started."}
					</p>
				</div>

				{mode === "signup" && (
					<div className="space-y-2">
						<Label htmlFor="name">Name</Label>
						<Input
							id="name"
							value={name}
							onChange={(e) => setName(e.target.value)}
							required
							autoComplete="name"
						/>
					</div>
				)}

				<div className="space-y-2">
					<Label htmlFor="email">Email</Label>
					<Input
						id="email"
						type="email"
						value={email}
						onChange={(e) => setEmail(e.target.value)}
						required
						autoComplete="email"
					/>
				</div>

				<div className="space-y-2">
					<Label htmlFor="password">Password</Label>
					<Input
						id="password"
						type="password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						required
						minLength={8}
						autoComplete={
							mode === "signin" ? "current-password" : "new-password"
						}
					/>
				</div>

				{error && <p className="text-sm text-destructive">{error}</p>}

				<Button type="submit" disabled={pending} className="w-full">
					{pending
						? "Working…"
						: mode === "signin"
							? "Sign in"
							: "Create account"}
				</Button>

				<div className="text-center text-sm text-muted-foreground">
					{mode === "signin" ? (
						<>
							No account?{" "}
							<button
								type="button"
								onClick={() => setMode("signup")}
								className="text-foreground underline-offset-4 hover:underline"
							>
								Sign up
							</button>
						</>
					) : (
						<>
							Already have one?{" "}
							<button
								type="button"
								onClick={() => setMode("signin")}
								className="text-foreground underline-offset-4 hover:underline"
							>
								Sign in
							</button>
						</>
					)}
				</div>

				<div className="text-center text-xs text-muted-foreground">
					<Link to="/" className="hover:text-foreground">
						← back to home
					</Link>
				</div>
			</form>
		</div>
	);
}
