# Monitoring and Metrics

Wharfie also monitors Athena by deriving and publishing the following cloudwatch metrics

### Succeeded queries

**Namespace**: `DataPlatform/Athena`

**Metric Name**: `SUCCEEDED-queries`

**Dimensions**: StatementType, Workgroup, Database, Table

**Value**: Bytes scanned

### Failed queries

**Namespace**: `DataPlatform/Athena`

**Metric Name**: `FAILED-queries`

**Dimensions**: StatementType, Workgroup, Database, Table

**Value**: Bytes scanned

### Cancelled queries

**Namespace**: `DataPlatform/Athena`

**Metric Name**: `CANCELLED-queries`

**Dimensions**: StatementType, Workgroup, Database, Table

**Value**: Bytes scanned

### Queued queries

**Namespace**: `DataPlatform/Athena`

**Metric Name**: `QUEUED-queries`

**Dimensions**: StatementType, Workgroup, Database, Table

**Value**: query count

### Running queries

**Namespace**: `DataPlatform/Athena`

**Metric Name**: `RUNNING-queries`

**Dimensions**: StatementType, Workgroup, Database, Table

**Value**: query count
