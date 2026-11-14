import Dexie, { type EntityTable } from 'dexie';
import type {
  Account, AuditEntry, BalanceSnapshot, Budget, Category, Debt, ExchangeRate, Goal,
  ImportBatch, InstallmentPlan, Pot, RecurringRule, SelfLoan, Transaction,
} from '../domain/schemas';

export interface Setting { key: string; value: unknown }
/** Records a deletion so it can propagate to other devices through the vault. */
export interface Tombstone { table: string; id: string; at: number }
export interface Attachment { id: string; blob: Blob; mime: string; createdAt: number }

/**
 * Local-first store (IndexedDB via Dexie). Index strings list only what we
 * query on; everything else is stored but not indexed.
 */
export class ColonDB extends Dexie {
  accounts!: EntityTable<Account, 'id'>;
  pots!: EntityTable<Pot, 'id'>;
  categories!: EntityTable<Category, 'id'>;
  transactions!: EntityTable<Transaction, 'id'>;
  debts!: EntityTable<Debt, 'id'>;
  selfLoans!: EntityTable<SelfLoan, 'id'>;
  recurring!: EntityTable<RecurringRule, 'id'>;
  snapshots!: EntityTable<BalanceSnapshot, 'id'>;
  budgets!: EntityTable<Budget, 'id'>;
  goals!: EntityTable<Goal, 'id'>;
  rates!: EntityTable<ExchangeRate, 'id'>;
  importBatches!: EntityTable<ImportBatch, 'id'>;
  audit!: EntityTable<AuditEntry, 'id'>;
  attachments!: EntityTable<Attachment, 'id'>;
  settings!: EntityTable<Setting, 'key'>;
  installments!: EntityTable<InstallmentPlan, 'id'>;
  tombstones!: Dexie.Table<Tombstone, [string, string]>;

  constructor(name = 'colon') {
    super(name);
    this.version(1).stores({
      accounts: 'id, type, archived',
      pots: 'id, accountId, owner',
      categories: 'id, group, archived',
      transactions:
        'id, date, kind, categoryId, debtId, importBatchId, recurringId, linkId, from.accountId, to.accountId, *tags',
      debts: 'id, status',
      selfLoans: 'id, status',
      recurring: 'id, active',
      snapshots: 'id, accountId, date, [accountId+date], importBatchId',
      budgets: 'id, categoryId, month, [categoryId+month]',
      goals: 'id, potId',
      rates: 'id, date',
      importBatches: 'id, importedAt',
      audit: '++id, at, [table+recordId]',
      attachments: 'id',
      settings: 'key',
    });
    this.version(2).stores({
      installments: 'id, cardAccountId, status',
      transactions:
        'id, date, kind, categoryId, debtId, importBatchId, recurringId, linkId, installmentPlanId, from.accountId, to.accountId, *tags',
    });
    this.version(3).stores({ tombstones: '[table+id], at' });
  }
}

export const db = new ColonDB();
