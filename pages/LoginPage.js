import { BasePage } from './BasePage.js';

export class LoginPage extends BasePage {
  constructor(page) {
    super(page);
    this.usernameInput = page.getByPlaceholder('Usuario');
    this.passwordInput = page.getByPlaceholder('Contraseña');
    this.submitButton = page.getByRole('button', { name: 'Ingresar' });
    this.googleButton = page.getByRole('button', { name: 'Continuar con Google' });
  }

  async goto() {
    await this.navigate('/');
  }

  /** The app is a client-rendered SPA: the form appearing is the hydration signal. */
  async waitForHydration() {
    await this.submitButton.waitFor({ state: 'visible' });
  }

  async login(username, password) {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }
}
