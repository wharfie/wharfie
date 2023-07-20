# wharfie alarms

## BootstrapLambdaErrors

This is caused by an unhandled error during an update of a wharfie resource. This alarm is very unlikely to be a wharfie wide issue and at most will only be affecting updating resources and not resources that are already running.

Its important that all errors are handled in this lambda though to make sure cloudformation stacks don't get in a stuck state, so you should look at this lambdas logs to figure out what was unhandled and make a github issue.

## DaemonDeadLetterQueueAlarm

This is caused by an unhandled error in the `Daemon` lambda that couldn't be associated with a particular Wharfie resource. This error will most likely be caused by a bad code change, aws outage, or wharfie dynamodb throttling but there may be some yet uncovered edge case events that might cause this as well.

after resolving the root cause `load replay daemon` will replay this dlq, all messages should be able to be replayed.

## DaemonResourceDeadLetterQueueAlarm

This is caused by an unhandled error in the `Daemon` lambda thats associated with a particular Wharfie resource. These errors could be caused by bad user usage and might not ever be replayed successfully. Its possible for users to trigger this alarm by incorrectly configuring wharfie resources.

after resolving the root cause `load replay daemon-resource -p` will replay this dlq, `-p`(purge) is needed b/c not every message will be replayed successfully since these can be caused by user error

## MonitorDeadLetterQueueAlarm

This is caused by an unhandled error in the `Monitor` lambda that couldn't be associated with a particular Wharfie resource. This error will most likely be caused by a bad code change, aws outage, or wharfie dynamodb throttling but there may be some yet uncovered edge case events that might cause this as well.

after resolving the root cause `load replay monitor` will replay this dlq, all messages should be able to be replayed.

## MonitorResourceDeadLetterQueueAlarm

This is caused by an unhandled error in the `Monitor` lambda thats associated with a particular Wharfie resource. These errors could be caused by users and might not ever be replayed successfully. Its possible for users to trigger this alarm by incorrectly configuring wharfie resources.

after resolving the root cause `load replay monitor-resource -p` will replay this dlq, `-p`(purge) is needed b/c not every message will be replayed successfully since these can be caused by user error

## EventsDeadLetterQueueAlarm

This is caused by an unhandled error in the `Events` lambda. This error will most likely be caused by a bad code change, aws outage, or wharfie dynamodb throttling but there may be some yet uncovered edge case events that might cause this as well.

after resolving the root cause `load replay events` will replay this dlq, all messages should be able to be replayed.

## CleanupDeadLetterQueueAlarm

This is caused by an unhandled error in the `Cleanup` lambda. This error will most likely be caused by a bad code change, aws outage, or wharfie dynamodb throttling but there may be some yet uncovered edge case events that might cause this as well.

after resolving the root cause `load replay cleanup` will replay this dlq, all messages should be able to be replayed.
