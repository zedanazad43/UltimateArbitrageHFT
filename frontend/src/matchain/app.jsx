import React from 'react';
import { MatchIDProvider } from '@matchain/matchid-sdk-react';

const MATCHAIN_CONFIG = {
  projectId: 'fsthjglonup0fpbj',
  // Enable login methods you want
  loginMethods: {
    wallet: true,
    walletEvm: true,
    walletBitcoin: true,
    walletSolana: true,
    walletTron: true,
    walletTon: true,
    email: true,
    twitter: true,
    telegram: true,
    google: true,
    github: true,
    discord: true,
    linkedin: true,
    kakao: true,
  },
  // Optional theme overrides
  theme: {
    mode: 'dark',
    primaryColor: '#f0b90b',
  },
};

export default function MatchAINApp({ children }) {
  return (
    <MatchIDProvider {...MATCHAIN_CONFIG}>
      {children}
    </MatchIDProvider>
  );
}
