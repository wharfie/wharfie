# Trouble Shooting

This document outlines different situations users find themselves in and how one might resolve it. This is not a comprehensive list. If your problem isn't listed here please feel free to add it. If it is listed and the solution doesn't work for you, its very likly that you are dealing with an ambigous error message. When you figure out the solution, please consider adding it back here.

## Table won't populate

### Raw view table is stale

```
SYNTAX_ERROR: line 1:38: View 'awsdatacatalog.${DATABASE}.${TABLE}_raw' is stale; it must be re-created
```

This error message is created when the columns (including partition keys) don't match the SQL statement that defines the view.

\*_Is your view a `SELECT _ FROM ...` view?

If so, check that the table you are selecting from has the same columns in the same order as the one that is stale. Also, consider not using a `SELECT * FROM` query as it means any change to your upstream dataset will break this view.

\*\*Are the columns returned by your SELECT statement in the same order as the COLUMNS defining the view?

If they are not than Athena is unable to fill out the view with your subquery. To fix this select each column specificly and confirm its type is what is provided in the table defintion.

\*\*Are the types of your SELECT statement the same as those in the Glue defintion?

If they are not than Athena is unable to fill out the view with your subquery. Find which columns need to be updated and update either your SELECT statement to provided differnet column types or update the types of your Columns and PartitionKeys.
