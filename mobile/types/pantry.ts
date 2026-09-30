export type PantryDateKind = 'best_before' | 'use_by';

export interface PantryItemFields {
  name: string;
  quantity: string | null;
  unit: string | null;
  location: string | null;
  date_kind: PantryDateKind | null;
  date_value: string | null;
  notes: string | null;
}

export interface PantryItem extends PantryItemFields {
  id: string;
  created_at: string;
  updated_at: string;
}

export interface PantrySnapshot {
  space_id: string;
  scope: 'personal' | 'household';
  list_id: string | null;
  revision: number;
  items: PantryItem[];
  transferred_grocery_item_ids: string[];
  copied_personal_item_ids: string[];
  server_time: string;
}

export interface PantryMutationRequest {
  mutation_id: string;
  space_id: string;
  scope: 'active' | 'personal';
  operation: 'add' | 'update' | 'delete';
  item_id: string;
  item?: PantryItemFields;
  changes?: Partial<PantryItemFields>;
  base_revision?: number;
}

export interface PantryTransferLine {
  grocery_item_id: string;
  quantity: string | null;
  unit: string | null;
  location: string | null;
  date_kind: PantryDateKind | null;
  date_value: string | null;
}
