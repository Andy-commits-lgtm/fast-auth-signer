/* eslint-disable import/extensions */
/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable react/jsx-props-no-spreading */
/* eslint-disable jsx-a11y/label-has-associated-control */
import { createKey, isPassKeyAvailable } from '@near-js/biometric-ed25519';
import { sendSignInLinkToEmail } from 'firebase/auth';
import * as React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link, redirect, useNavigate } from 'react-router-dom';
import styled from 'styled-components';

import { Button } from '../../lib/Button';
import { openToast } from '../../lib/Toast';
import { useAuthStore } from '../../stores/auth';
import { useCurrentComponentStore } from '../../stores/current-component';
import { network } from '../../utils/config';
import { firebaseAuth } from '../../utils/firebase';
import {
  accountAddressPatternNoSubaccount, emailPattern, getEmailId, isValidEmail
} from '../../utils/form-validation';
import './CreateAccount.css';

const ErrorText = styled.p`
  color: hsla(8, 100%, 33%, 1);
`;

const StyledContainer = styled.div`
  width: 100%;
  height: calc(100vh - 66px);
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: #f2f1ea;
  padding: 0 16px;
`;

const FormContainer = styled.form`
  max-width: 450px;
  width: 100%;
  margin: 16px auto;
  background-color: #ffffff;
  padding: 16px;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const InputContainer = styled.div`
  width: 100%;
  display: flex;
  flex-direction: column;

  label {
    font-size: 12px;
    font-weight: 500;
  }

  input {
    padding: 8px 12px;
    border: 1px solid #e5e5e5;
    border-radius: 10px;
    font-size: 14px;
    margin-top: 4px;
    min-height: 50px;
    cursor: text;

    &:focus {
      outline: none;
      border: 1px solid #e5e5e5;
    }
  }

  .subText {
    font-size: 0.75rem;
    padding: 8px 0;

    .error {
      color: hsla(8, 100%, 33%, 1);
    }

    .success {
      color: hsla(155, 66%, 32%, 1);
    }
  }
`;

const handleCreateAccount = async (accountId, email, isRecovery) => {
  const keyPair = await createKey(email);
  const publicKey = keyPair.getPublicKey().toString();

  if (!publicKey) {
    throw new Error('No public key found');
  }

  const accountDataStash = {
    accountId,
    isCreated: false,
  };
  window.localStorage.setItem('fast-auth:account-creation-data', JSON.stringify(accountDataStash));
  await sendSignInLinkToEmail(firebaseAuth, email, {
    url: encodeURI(
      `${window.location.origin}/auth-callback?publicKey=${publicKey}&accountId=${accountId}${
        isRecovery ? '&isRecovery=true' : ''}`,
    ),
    handleCodeInApp: true,
  });
  window.localStorage.setItem('emailForSignIn', email);
  return { email, publicKey, accountId };
};

function CreateAccount() {
  const setComponentSrc = useCurrentComponentStore((store) => store.setSrc);
  const [isAccountAvailable, setIsAccountAvailable] = useState<boolean | null>(null);
  const [isAccountValid, setIsAccountValid] = useState<boolean | null>(null);
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, touchedFields },
    clearErrors,
  } = useForm();
  const formValues = watch();
  const signedIn = useAuthStore((store) => store.signedIn);
  const navigate = useNavigate();

  useEffect(() => {
    const checkPassKey = async (): Promise<void> => {
      const isPasskeyReady = await isPassKeyAvailable();
      if (!isPasskeyReady) {
        openToast({
          title: '',
          type:  'INFO',
          description:
            'Passkey support is required for account creation. Try using an updated version of Chrome or Safari to create an account.',
          duration: 5000,
        });
      }
    };
    checkPassKey();
  }, []);

  // redirect to home upon signing in
  useEffect(() => {
    if (signedIn) {
      redirect('/');
    }
  }, [signedIn]);

  useEffect(() => {
    setComponentSrc(null);
  }, [setComponentSrc]);

  const checkIsAccountAvailable = useCallback(async (desiredUsername: string) => {
    // set to null to show loading
    setIsAccountAvailable(null);
    try {
      if (!desiredUsername) return;

      const response = await fetch(network.nodeUrl, {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id:      'dontcare',
          method:  'query',
          params:  {
            request_type: 'view_account',
            finality:     'final',
            account_id:   `${desiredUsername}.${network.fastAuth.accountIdSuffix}`,
          },
        }),
      });
      const data = await response.json();
      if (data?.error?.cause?.name === 'UNKNOWN_ACCOUNT') {
        // eslint-disable-next-line consistent-return
        return setIsAccountAvailable(true);
      }

      if (data?.result?.code_hash) {
        // eslint-disable-next-line consistent-return
        return setIsAccountAvailable(false);
      }
    } catch (error) {
      console.log(error);
      setIsAccountAvailable(false);
    }
  }, []);

  const onSubmit = handleSubmit(async (data: { email: string; username: string; }) => {
    if (!data || !data?.username || !data.email) return;
    try {
      const fullAccountId = `${data.username}.${network.fastAuth.accountIdSuffix}`;
      const { publicKey, accountId, email } = await handleCreateAccount(fullAccountId, data.email, false);
      navigate(
        `/verify-email?publicKey=${encodeURIComponent(publicKey)}&accountId=${encodeURIComponent(
          accountId,
        )}&email=${encodeURIComponent(email)}`,
      );
    } catch (error: any) {
      openToast({
        type:  'ERROR',
        title: error.message,
      });
    }
  });

  useEffect(() => {
    clearErrors('username');
    if (!formValues?.username?.length) {
      setIsAccountValid(null);
      setIsAccountAvailable(null);
      return;
    }

    const isValid = accountAddressPatternNoSubaccount.test(formValues?.username);
    setIsAccountValid(isValid);
    if (!isValid) return;

    checkIsAccountAvailable(formValues?.username);
  }, [checkIsAccountAvailable, clearErrors, formValues?.username]);

  // status message, doesn't need to be overoptimized with memoization
  let accountStatusMessage = '';
  let accountStatusState; // "error" or "success"
  if (!formValues?.username?.length) {
    accountStatusMessage = 'Use a suggested ID or customize your own.';
  } else if (!isAccountValid) {
    accountStatusMessage = 'Accounts must be lowercase and may contain - or _, but they may not begin or end with a special character or have two consecutive special characters.';
    accountStatusState = 'error';
  } else {
    // valid account is entered, handle availability
    // eslint-disable-next-line no-lonely-if
    if (isAccountAvailable === null) {
      accountStatusMessage = 'Checking availability...';
    } else if (isAccountAvailable) {
      accountStatusMessage = `${formValues?.username}.${network.fastAuth.accountIdSuffix} is available!`;
      accountStatusState = 'success';
    } else {
      accountStatusMessage = `${formValues?.username}.${network.fastAuth.accountIdSuffix} is taken, try something else.`;
      accountStatusState = 'error';
    }
  }

  return (
    <StyledContainer>
      <FormContainer onSubmit={onSubmit}>
        <header>
          <h1>Create account</h1>
          <p className="desc">Use this account to sign in everywhere on NEAR, no password required.</p>
        </header>

        <InputContainer>
          <label htmlFor="email">Email</label>

          <input
            {...register('email', {
              required: 'Please enter a valid email address',
              pattern:  {
                value:   emailPattern,
                message: 'Please enter a valid email address',
              },
            })}
            onChange={(e) => {
              clearErrors('email');
              setValue('email', e.target.value);
              if (!isValidEmail(e.target.value)) return;
              if (!formValues?.username || !touchedFields?.username) {
                setValue('username', getEmailId(e.target.value));
              }
            }}
            placeholder="user_name@email.com"
            type="email"
          />
          {/* shouldn't need to do a type check here but message is not resolving as a string for some reason */}
          {typeof errors.email?.message === 'string' && <ErrorText role="alert">{errors.email?.message}</ErrorText>}
        </InputContainer>

        <InputContainer>
          <label htmlFor="username">Account ID</label>
          <input
            autoComplete="webauthn username"
            {...register('username', {
              required: 'Please enter a valid account ID',
              pattern:  {
                value:   accountAddressPatternNoSubaccount,
                message: 'Please enter a valid account ID',
              },
              validate: () => {
                if (!isAccountAvailable) {
                  return 'Please enter a valid account ID';
                }
                return null;
              },
            })}
            placeholder="user_name.near"
          />
          <p className="subText">
            <span className={accountStatusState || ''}>{accountStatusMessage}</span>
          </p>
          {/* shouldn't need to do a type check here but message is not resolving as a string for some reason */}
          {typeof errors.username?.message === 'string' && (
            <ErrorText role="alert">{errors.username?.message}</ErrorText>
          )}
        </InputContainer>

        <Button label="Continue" variant="affirmative" type="submit" />

        <hr style={{ borderColor: 'hsl(55, 1.7%, 51.9%)' }} />

        <p>
          Already have an account?
          {' '}
          <Link to="/signin" style={{ color: 'hsla(246, 57%, 61%, 1)', fontWeight: 500 }}>
            Sign In
          </Link>
        </p>
      </FormContainer>
    </StyledContainer>
  );
}

export default CreateAccount;
