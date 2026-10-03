package expo.modules.zerovault

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index

@Entity(
  tableName = "vault_ciphertexts",
  primaryKeys = ["account_id", "record_id"],
  indices = [
    Index(value = ["account_id", "has_conflict"]),
    Index(value = ["account_id", "is_deleted"]),
  ],
)
data class CiphertextRecordEntity(
  @ColumnInfo(name = "account_id") val accountId: String,
  @ColumnInfo(name = "record_id") val recordId: String,
  @ColumnInfo(name = "ciphertext_envelope_json") val ciphertextEnvelopeJson: String,
  @ColumnInfo(name = "item_revision") val itemRevision: Long,
  @ColumnInfo(name = "last_synced_at") val lastSyncedAt: String,
  @ColumnInfo(name = "has_conflict") val hasConflict: Boolean,
  @ColumnInfo(name = "item_type") val itemType: String? = null,
  @ColumnInfo(name = "is_deleted", defaultValue = "0") val isDeleted: Boolean = false,
)

@Entity(tableName = "sync_cursors", primaryKeys = ["account_id"])
data class SyncCursorEntity(
  @ColumnInfo(name = "account_id") val accountId: String,
  @ColumnInfo(name = "server_revision") val serverRevision: Long,
  @ColumnInfo(name = "last_synced_at") val lastSyncedAt: String?,
  @ColumnInfo(name = "server_cursor") val serverCursor: Long? = null,
  @ColumnInfo(name = "schema_version", defaultValue = "2") val schemaVersion: Int = 2,
)

@Entity(
  tableName = "pending_mutations",
  primaryKeys = ["account_id", "client_mutation_id"],
  indices = [Index(value = ["account_id", "record_id"], unique = true)],
)
data class PendingMutationEntity(
  @ColumnInfo(name = "account_id") val accountId: String,
  @ColumnInfo(name = "client_mutation_id") val clientMutationId: String,
  @ColumnInfo(name = "record_id") val recordId: String,
  @ColumnInfo(name = "operation") val operation: String,
  @ColumnInfo(name = "base_item_revision") val baseItemRevision: Long,
  @ColumnInfo(name = "ciphertext_envelope_json") val ciphertextEnvelopeJson: String?,
  @ColumnInfo(name = "created_at") val createdAt: String,
  @ColumnInfo(name = "attempt_count", defaultValue = "0") val attemptCount: Int = 0,
  @ColumnInfo(name = "last_error_code") val lastErrorCode: String? = null,
)

@Entity(
  tableName = "sync_conflicts",
  primaryKeys = ["account_id", "record_id"],
  indices = [Index(value = ["account_id", "status"])],
)
data class SyncConflictEntity(
  @ColumnInfo(name = "account_id") val accountId: String,
  @ColumnInfo(name = "record_id") val recordId: String,
  @ColumnInfo(name = "reason") val reason: String,
  @ColumnInfo(name = "local_ciphertext_envelope_json") val localCiphertextEnvelopeJson: String?,
  @ColumnInfo(name = "remote_ciphertext_envelope_json") val remoteCiphertextEnvelopeJson: String?,
  @ColumnInfo(name = "server_revision") val serverRevision: Long,
  @ColumnInfo(name = "server_item_revision") val serverItemRevision: Long?,
  @ColumnInfo(name = "status", defaultValue = "'UNRESOLVED'") val status: String = "UNRESOLVED",
  @ColumnInfo(name = "created_at") val createdAt: String,
)

@Entity(tableName = "device_state", primaryKeys = ["account_id"])
data class DeviceStateEntity(
  @ColumnInfo(name = "account_id") val accountId: String,
  @ColumnInfo(name = "device_id") val deviceId: String,
  @ColumnInfo(name = "public_key") val publicKey: String,
  @ColumnInfo(name = "fingerprint") val fingerprint: String,
  @ColumnInfo(name = "encrypted_vault_key") val encryptedVaultKey: String?,
  @ColumnInfo(name = "created_at") val createdAt: String,
)
