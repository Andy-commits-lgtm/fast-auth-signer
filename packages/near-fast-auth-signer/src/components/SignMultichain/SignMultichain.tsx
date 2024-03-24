import { borshDeserialize, borshSerialize } from 'borsher';
import React, {
  useEffect, useState, useCallback, useRef
} from 'react';

import { derivationPathSchema } from './schema';
import { Chain, DerivationPathDeserialized, MultichainInterface } from './types';
import {
  validateMessage,
  getTokenAndTotalPrice,
  multichainAssetToNetworkName,
  shortenAddress,
  multichainSignAndSend,
  multichainGetFeeProperties,
  TransactionFeeProperties
} from './utils';
import { getAuthState } from '../../hooks/useAuthState';
import useFirebaseUser from '../../hooks/useFirebaseUser';
import useIframeDialogConfig from '../../hooks/useIframeDialogConfig';
import InternetSvg from '../../Images/Internet';
import ModalIconSvg from '../../Images/ModalIcon';
import { Button } from '../../lib/Button';
import { ModalSignWrapper } from '../Sign/Sign.styles';
import TableContent from '../TableContent/TableContent';
import { TableRow } from '../TableRow/TableRow';

borshSerialize(derivationPathSchema, { asset: 'ETH', domain: '' }).toString('base64');

type IncomingMessageData = {
  chainId: bigint;
  derivationPath: string;
  to: string;
  value: bigint;
  from: string;
};

type IncomingMessageEvent = MessageEvent<{
  data: IncomingMessageData;
  type: string;
}>;

type TransactionAmountDisplay = {
  price: string | number;
  tokenAmount: string | number;
  feeProperties?: TransactionFeeProperties;
};

function SignMultichain() {
  const { loading: firebaseUserLoading, user: firebaseUser } = useFirebaseUser();
  const signTransactionRef = useRef(null);
  const [amountInfo, setAmountInfo] = useState<TransactionAmountDisplay>({ price: '...', tokenAmount: 0 });
  const [message, setMessage] = useState<MultichainInterface>(null);
  const [inFlight, setInFlight] = useState(false);
  const [error, setError] = useState(null);
  const [isValid, setValid] = useState(null);
  const [deserializedDerivationPath, setDeserializedDerivationPath] = useState<DerivationPathDeserialized>(null);
  const [origin, setOrigin] = useState(null);

  // Send form height to modal if in iframe
  useIframeDialogConfig({
    element: signTransactionRef.current,
    onClose: () => window.parent.postMessage({ type: 'method', message: 'User cancelled action' }, '*')
  });

  const onError = (text: string) => {
    window.parent.postMessage({ type: 'multiChainResponse', message: text }, '*');
    setError(text);
  };

  const deserializeDerivationPath = useCallback((path: string): DerivationPathDeserialized | Error => {
    try {
      const deserialize: DerivationPathDeserialized = borshDeserialize(derivationPathSchema, Buffer.from(path, 'base64'));
      setDeserializedDerivationPath(deserialize);
      return deserialize;
    } catch (e) {
      onError(`fail to deserialize derivation path: ${e.message}`);
      return e;
    }
  }, []);

  const signMultichainTransaction = useCallback(async (
    derivationPath: {
    asset?: Chain,
    domain?: string
  },
    transaction: {
      to: string,
      value: bigint,
    },
    feeProperties: TransactionFeeProperties
  ) => {
    try {
      const isUserAuthenticated = await getAuthState(firebaseUser?.email);
      if (isUserAuthenticated !== true) {
        onError('You are not authenticated or there has been an indexer failure');
      } else {
        const response = await multichainSignAndSend({
          domain:        derivationPath?.domain,
          asset:         derivationPath?.asset,
          to:            transaction?.to,
          value:         transaction?.value.toString(),
          feeProperties
        });
        if (response.success) {
          window.parent.postMessage({ type: 'multiChainResponse', message: `Successfully sign and send transaction, ${response.transactionHash}` }, '*');
        } else if (response.success === false) {
          onError(response.errorMessage);
        }
      }
    } catch (e) {
      onError(e.message);
      throw new Error('Failed to sign delegate');
    }
  }, [firebaseUser?.email]);

  useEffect(() => {
    const handleMessage = async (event: IncomingMessageEvent) => {
      if (event?.data?.type === 'multiChainRequest' && event?.data?.data) {
        setOrigin(event?.origin);
        try {
          const { data: transaction } = event.data;
          setInFlight(true);
          const deserialize = deserializeDerivationPath(transaction.derivationPath);
          if (deserialize instanceof Error) {
            onError(deserialize.message);
            return;
          }

          const validation = await validateMessage(transaction, deserialize.asset);
          if (validation instanceof Error || !validation) {
            onError(validation.toString());
            return;
          }

          const { tokenAmount, tokenPrice } = await getTokenAndTotalPrice(deserialize.asset, transaction.value);
          const { feeDisplay, ...feeProperties } = await multichainGetFeeProperties({
            asset: deserialize?.asset,
            to:    transaction.to,
            value: transaction.value.toString(),
            ...('from' in transaction ? { from: transaction.from } : {}),
          });
          const gasFeeInUSD = parseFloat(feeDisplay.toString()) * tokenPrice;
          const transactionCost =  Math.ceil(gasFeeInUSD * 100) / 100;

          setAmountInfo({
            price: transactionCost,
            tokenAmount,
            feeProperties
          });

          setValid(true);
          if (deserialize?.domain === event?.origin) {
            await signMultichainTransaction(deserialize, transaction, feeProperties);
          } else {
            setMessage(transaction);
          }
        } catch (e) {
          onError(e.message);
        } finally {
          setInFlight(false);
        }
      }
    };

    window.addEventListener(
      'message',
      handleMessage,
    );

    window.parent.postMessage({ type: 'signMultiChainLoaded' }, '*');

    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, [deserializeDerivationPath, signMultichainTransaction]);

  const onConfirm = async () => {
    setError(null);
    setInFlight(true);
    try {
      await signMultichainTransaction(deserializedDerivationPath, message, amountInfo.feeProperties);
    } catch (e) {
      onError(e.message);
    } finally {
      setInFlight(false);
    }
  };

  return (
    <ModalSignWrapper ref={signTransactionRef}>
      <div className="modal-top">
        <ModalIconSvg />
        <h3>Approve Transaction?</h3>
        <h5>{`${deserializedDerivationPath?.domain || 'Unknown App'} has requested a transaction, review the request before confirming.`}</h5>
        <div className="transaction-details">
          <InternetSvg />
          {origin || 'Unknown App'}
        </div>
      </div>
      <div className="modal-middle">
        <div className="table-wrapper">
          <TableContent
            leftSide="Details"
            rightSide={(
              <TableRow
                content={`${amountInfo.tokenAmount ? `Send ${amountInfo.tokenAmount} ${deserializedDerivationPath?.asset}` : '...'}`}
              />
            )}
          />
          <TableContent
            leftSide="to"
            rightSide={(
              <TableRow
                asset={deserializedDerivationPath?.asset}
                content={<b><span title={message?.to || ''}>{`${shortenAddress(message?.to || '...')}`}</span></b>}
              />
            )}
          />
          <TableContent
            leftSide="Network"
            rightSide={(
              <TableRow
                asset={deserializedDerivationPath?.asset}
                content={multichainAssetToNetworkName(deserializedDerivationPath?.asset)}
              />
            )}
          />
        </div>
        <div className="table-wrapper margin-top">
          <TableContent
            leftSide="Estimated Fees"
            infoText="The estimated total of your transaction including fees."
            rightSide={`${typeof amountInfo?.price === 'number' ? `$${amountInfo.price}` : '...'}`}
          />
        </div>
      </div>
      <div className="modal-footer">
        <Button
          variant="affirmative"
          size="large"
          label={inFlight ? 'Loading...' : 'Approve'}
          onClick={onConfirm}
          disabled={inFlight || !isValid || firebaseUserLoading || !firebaseUser || typeof amountInfo.price !== 'number'}
        />
      </div>
      {!firebaseUserLoading && !firebaseUser && <p className="info-text">You are not authenticated!</p>}
      {error && <p className="info-text error">{error}</p>}
    </ModalSignWrapper>
  );
}

export default SignMultichain;
