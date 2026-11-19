export interface WithdrawalReadyEventDetail {
  id?: string;
  withdrawalId?: string;
  transactionHash?: string;
  txHash?: string;
  amount?: string | number | null;
  asset?: string | null;
  timestamp?: string | number;
  status?: string;
  [key: string]: unknown;
}

export interface InAppNotification {
  id: string;
  withdrawalId: string;
  transactionHash: string;
  title: string;
  description: string;
  amount: string | null;
  asset: string | null;
  timestamp: string; // ISO 8601 string
  status: "completed";
  read: boolean;
  createdAt: number;
}
