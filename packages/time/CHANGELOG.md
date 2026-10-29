# @krizaka/time

## 0.2.0

### Minor Changes

- 2a7898c: `isIsoDate`, `isEmail`, `isHttpUrl`, `isSlug`, `isE164Phone`, `isCanadianPostalCode`: the helpers the new no-hand-written-validation-regex rule points to (krizaka/.github#422).

## 0.1.0

### Minor Changes

- da6d980: New package: date arithmetic on an instant (`addSeconds`, `addMinutes`, `addHours`, `subSeconds`, `subMinutes`, `subHours`, `differenceInSeconds`, `differenceInMilliseconds`, `isBefore`, `isAfter`), exact in any time zone: the facade the « Krizaka first » dates rule points to (krizaka-ts#76), so the new packages import no date library of their own.
