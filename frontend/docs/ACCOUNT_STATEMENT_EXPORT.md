# Account Statement Export

YieldVault can generate a downloadable account statement that combines current portfolio holdings with wallet transactions for a selected date range.

## Where to find it

- **Portfolio** → Position Details toolbar → **Export Statement**
- **Transactions** → toolbar → **Export Statement** (uses the currently filtered/sorted transaction list when available)

## Formats

| Format | Contents |
|--------|----------|
| CSV | Summary key/value section, holdings table, transactions table |
| JSON | Nested `{ summary, holdings, transactions }` document |

## Implementation notes

- Pure builders live in `frontend/src/lib/accountStatement.ts` (filter, aggregate, serialize).
- Browser download helpers live in `frontend/src/lib/exportDownload.ts` and are reused by the legacy **Export CSV** control on Transaction History.
- UI flow: `frontend/src/components/AccountStatementExport.tsx` (modal + format/date controls + async download button).
- When transactions are not passed in, the component fetches up to 200 recent Horizon operations for the connected wallet.
