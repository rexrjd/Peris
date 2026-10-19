import { expect, type Page } from '@playwright/test';

/** Shared live City/Map picker; Village keeps its existing native select. */
export async function selectCity(page: Page, id: number | string) {
    await page.getByRole('button', { name: /^Current city:/ }).click();
    const option = page.locator(`.city-selector-option[data-city-id="${id}"]`);
    await expect(option).toBeVisible(); await option.click();
}
