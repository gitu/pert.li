import { expect, test } from "../console";
import { signUpFreshUser } from "../fixtures";

// Start unauthenticated: this spec signs up its own fresh user so it gets a
// pristine, empty workspace. The shared E2E_USER won't do — other specs create
// projects in it, so by the time this runs its workspace is no longer empty and
// the seed never fires.
test.use({ storageState: { cookies: [], origins: [] } });

// The first visit to an empty workspace auto-seeds two sample projects. Because
// the fresh user's workspace is guaranteed empty and the seeded docs land in the
// local pending list immediately, both titles appear in the same context — no
// dependency on server registration or cross-spec ordering. Uses the
// console-clean fixture: the feature swallows seed errors, so any console noise
// would be a real regression.
test("an empty workspace auto-seeds the sample projects", async ({
	page,
	context,
}) => {
	await signUpFreshUser(page, context);

	await page.goto("/");

	await expect(page.getByText("PERT tutorial").first()).toBeVisible({
		timeout: 15_000,
	});
	await expect(page.getByText("Monte Carlo risk sample").first()).toBeVisible({
		timeout: 15_000,
	});
});
