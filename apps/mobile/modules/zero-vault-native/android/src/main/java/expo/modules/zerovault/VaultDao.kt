package expo.modules.zerovault

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface VaultCiphertextDao {
  @Query("SELECT * FROM vault_ciphertexts WHERE account_id = :accountId AND is_deleted = 0 ORDER BY record_id")
  suspend fun list(accountId: String): List<CiphertextRecordEntity>

  @Query("SELECT * FROM vault_ciphertexts WHERE account_id = :accountId ORDER BY record_id")
  suspend fun listIncludingTombstones(accountId: String): List<CiphertextRecordEntity>

  @Query("SELECT * FROM vault_ciphertexts WHERE account_id = :accountId AND record_id = :recordId LIMIT 1")
  suspend fun get(accountId: String, recordId: String): CiphertextRecordEntity?

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun upsert(record: CiphertextRecordEntity)

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun upsertAll(records: List<CiphertextRecordEntity>)

  @Query("DELETE FROM vault_ciphertexts WHERE account_id = :accountId AND record_id = :recordId")
  suspend fun delete(accountId: String, recordId: String)

  @Query("DELETE FROM vault_ciphertexts WHERE account_id = :accountId AND record_id IN (:recordIds)")
  suspend fun deleteAll(accountId: String, recordIds: List<String>)

  @Query("UPDATE vault_ciphertexts SET has_conflict = 0 WHERE account_id = :accountId")
  suspend fun clearConflicts(accountId: String)

  @Query("UPDATE vault_ciphertexts SET has_conflict = 1 WHERE account_id = :accountId AND record_id IN (:recordIds)")
  suspend fun markConflicts(accountId: String, recordIds: List<String>)

  @Query("UPDATE vault_ciphertexts SET has_conflict = :hasConflict WHERE account_id = :accountId AND record_id = :recordId")
  suspend fun setConflict(accountId: String, recordId: String, hasConflict: Boolean)

  @Query("DELETE FROM vault_ciphertexts WHERE account_id = :accountId")
  suspend fun clear(accountId: String)
}

@Dao
interface SyncCursorDao {
  @Query("SELECT * FROM sync_cursors WHERE account_id = :accountId LIMIT 1")
  suspend fun get(accountId: String): SyncCursorEntity?

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun upsert(cursor: SyncCursorEntity)

  @Query("DELETE FROM sync_cursors WHERE account_id = :accountId")
  suspend fun delete(accountId: String)
}

@Dao
interface PendingMutationDao {
  @Query("SELECT * FROM pending_mutations WHERE account_id = :accountId ORDER BY created_at, client_mutation_id")
  suspend fun list(accountId: String): List<PendingMutationEntity>

  @Query("SELECT * FROM pending_mutations WHERE account_id = :accountId AND record_id = :recordId LIMIT 1")
  suspend fun getForRecord(accountId: String, recordId: String): PendingMutationEntity?

  @Query("SELECT * FROM pending_mutations WHERE account_id = :accountId AND client_mutation_id IN (:mutationIds)")
  suspend fun getAll(accountId: String, mutationIds: List<String>): List<PendingMutationEntity>

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun upsert(mutation: PendingMutationEntity)

  @Query("DELETE FROM pending_mutations WHERE account_id = :accountId AND client_mutation_id IN (:mutationIds)")
  suspend fun deleteAll(accountId: String, mutationIds: List<String>)

  @Query("DELETE FROM pending_mutations WHERE account_id = :accountId AND record_id = :recordId")
  suspend fun deleteForRecord(accountId: String, recordId: String)

  @Query("DELETE FROM pending_mutations WHERE account_id = :accountId")
  suspend fun clear(accountId: String)
}

@Dao
interface SyncConflictDao {
  @Query("SELECT * FROM sync_conflicts WHERE account_id = :accountId AND status = 'UNRESOLVED' ORDER BY created_at, record_id")
  suspend fun list(accountId: String): List<SyncConflictEntity>

  @Query("SELECT * FROM sync_conflicts WHERE account_id = :accountId AND record_id = :recordId LIMIT 1")
  suspend fun get(accountId: String, recordId: String): SyncConflictEntity?

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun upsert(conflict: SyncConflictEntity)

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun upsertAll(conflicts: List<SyncConflictEntity>)

  @Query("UPDATE sync_conflicts SET status = :status WHERE account_id = :accountId AND record_id = :recordId")
  suspend fun setStatus(accountId: String, recordId: String, status: String)

  @Query("DELETE FROM sync_conflicts WHERE account_id = :accountId AND record_id = :recordId")
  suspend fun delete(accountId: String, recordId: String)

  @Query("DELETE FROM sync_conflicts WHERE account_id = :accountId")
  suspend fun clear(accountId: String)
}

@Dao
interface DeviceStateDao {
  @Query("SELECT * FROM device_state WHERE account_id = :accountId LIMIT 1")
  suspend fun get(accountId: String): DeviceStateEntity?

  @Query("SELECT * FROM device_state ORDER BY created_at DESC LIMIT 1")
  suspend fun active(): DeviceStateEntity?

  @Insert(onConflict = OnConflictStrategy.REPLACE)
  suspend fun upsert(device: DeviceStateEntity)

  @Query("DELETE FROM device_state WHERE account_id = :accountId")
  suspend fun delete(accountId: String)
}
