import { expect, test as setup } from "@playwright/test";

import { credentials, Role, storageStatePath } from "../support/env";
import { loginThroughForm } from "../support/ui";

for (const role of ["user", "admin"] as Role[]) {
  setup(`log in as ${role}`, async ({ page }) => {
    const { email, password } = credentials(role);
    await loginThroughForm(page, email, password);
    await expect(page.getByRole("button", { name: /log ?in/i }).first()).toBeHidden();
    await page.context().storageState({ path: storageStatePath(role) });
  });
}
