DO $$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_replication_slots WHERE slot_name = 'physical_replica_slot') THEN
            PERFORM pg_create_physical_replication_slot('physical_replica_slot');
        END IF;
    END $$;