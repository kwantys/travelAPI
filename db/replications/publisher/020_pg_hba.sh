#!/bin/sh
set -e

echo "Configuring pg_hba.conf for physical replication..."
echo "host replication repuser 0.0.0.0/0 md5" >> /var/lib/postgresql/data/pg_hba.conf
echo "host all all 0.0.0.0/0 md5" >> /var/lib/postgresql/data/pg_hba.conf

echo "Reloading PostgreSQL configuration..."
pg_ctl reload

echo "Physical replication configuration completed"