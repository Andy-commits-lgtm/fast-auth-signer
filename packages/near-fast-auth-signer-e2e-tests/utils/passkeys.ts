import { KeyPair } from 'near-api-js';
import { Page } from 'playwright/test';

const configWindowTest = ({
  isPassKeyAvailable = true,
  keyCreationSecret,
  keyRetrievalSecret,
}) => {
  // @ts-ignore
  window.test = {
    // @ts-ignore
    ...window.test,
    isPassKeyAvailable: async () => isPassKeyAvailable,
    createKey:          () => keyCreationSecret,
    getKeys:            () => [keyRetrievalSecret, keyRetrievalSecret],
  };
};

export const setupPasskeysFunctions = async (page: Page, type: 'iframe' | 'page', config: {
  isPassKeyAvailable: boolean;
  keyPairForCreation: KeyPair;
  keyPairForRetrieval: KeyPair;
}) => {
  const setupPasskeysArgs = {
    ...config,
    // Using any to access private property
    keyCreationSecret:  (config.keyPairForCreation as any).secretKey,
    keyRetrievalSecret: (config.keyPairForRetrieval as any).secretKey
  };

  switch (type) {
    case 'iframe':
      page.on('frameattached', async (frame) => {
        await frame.evaluate(
          configWindowTest,
          setupPasskeysArgs
        );
      });
      break;
    case 'page':
      await page.addInitScript(
        configWindowTest,
        setupPasskeysArgs
      );
      break;
    default:
      throw new Error('Invalid type');
  }
};
