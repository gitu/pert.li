import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmailTransport } from "#/lib/email.server";

afterEach(() => {
	vi.resetModules();
	vi.restoreAllMocks();
});

describe("createEmailTransport", () => {
	it("falls back to console when nothing is configured outside production", () => {
		const transport = createEmailTransport({});
		expect(transport.kind).toBe("console");
	});

	it("refuses to fall back to console in production", () => {
		expect(() => createEmailTransport({ NODE_ENV: "production" })).toThrow(
			/No email transport configured in production/,
		);
	});

	it("still uses Resend in production when RESEND_API_KEY is set", () => {
		const transport = createEmailTransport({
			NODE_ENV: "production",
			RESEND_API_KEY: "re_test",
		});
		expect(transport.kind).toBe("resend");
	});

	it("still uses SMTP in production when SMTP_HOST is set", () => {
		const transport = createEmailTransport({
			NODE_ENV: "production",
			SMTP_HOST: "mail.example.com",
		});
		expect(transport.kind).toBe("smtp");
	});

	it("ALLOW_CONSOLE_EMAIL_IN_PROD=1 explicitly opts in to the console fallback", () => {
		const transport = createEmailTransport({
			NODE_ENV: "production",
			ALLOW_CONSOLE_EMAIL_IN_PROD: "1",
		});
		expect(transport.kind).toBe("console");
	});

	it("picks Resend when RESEND_API_KEY is set", () => {
		const transport = createEmailTransport({ RESEND_API_KEY: "re_test" });
		expect(transport.kind).toBe("resend");
	});

	it("picks SMTP over Resend when both are configured", () => {
		const transport = createEmailTransport({
			SMTP_HOST: "mail.example.com",
			RESEND_API_KEY: "re_test",
		});
		expect(transport.kind).toBe("smtp");
	});

	it("rejects invalid SMTP_PORT eagerly", () => {
		expect(() =>
			createEmailTransport({ SMTP_HOST: "mail", SMTP_PORT: "not-a-port" }),
		).toThrow(/SMTP_PORT/);
		expect(() =>
			createEmailTransport({ SMTP_HOST: "mail", SMTP_PORT: "70000" }),
		).toThrow(/SMTP_PORT/);
	});

	it("console transport logs the message instead of throwing", async () => {
		const transport = createEmailTransport({});
		const spy = vi.spyOn(console, "log").mockImplementation(() => {});
		await transport.send({ to: "a@b", subject: "hi", text: "msg" });
		expect(spy).toHaveBeenCalled();
		const logged = spy.mock.calls.flat().join("\n");
		expect(logged).toContain("a@b");
		expect(logged).toContain("msg");
	});

	it("SMTP transport sends through nodemailer", async () => {
		const sendMail = vi.fn().mockResolvedValue({ messageId: "x" });
		vi.doMock("nodemailer", () => ({
			default: { createTransport: vi.fn(() => ({ sendMail })) },
			createTransport: vi.fn(() => ({ sendMail })),
		}));
		const { createEmailTransport: factory } = await import(
			"#/lib/email.server"
		);
		const transport = factory({
			SMTP_HOST: "mail.example.com",
			SMTP_PORT: "587",
			SMTP_USER: "user",
			SMTP_PASS: "pass",
			SMTP_FROM: "no-reply@example.com",
		});
		await transport.send({ to: "to@x", subject: "s", text: "t" });
		expect(sendMail).toHaveBeenCalledWith({
			from: "no-reply@example.com",
			to: "to@x",
			subject: "s",
			text: "t",
		});
	});

	it("SMTP_SECURE defaults to true on port 465 and false elsewhere", async () => {
		const createTransport = vi.fn(() => ({
			sendMail: vi.fn().mockResolvedValue({}),
		}));
		vi.doMock("nodemailer", () => ({
			default: { createTransport },
			createTransport,
		}));
		const { createEmailTransport: factory } = await import(
			"#/lib/email.server"
		);

		await factory({ SMTP_HOST: "m", SMTP_PORT: "465" }).send({
			to: "x",
			subject: "s",
			text: "t",
		});
		expect(createTransport).toHaveBeenLastCalledWith(
			expect.objectContaining({ port: 465, secure: true }),
		);

		await factory({ SMTP_HOST: "m", SMTP_PORT: "587" }).send({
			to: "x",
			subject: "s",
			text: "t",
		});
		expect(createTransport).toHaveBeenLastCalledWith(
			expect.objectContaining({ port: 587, secure: false }),
		);
	});
});
