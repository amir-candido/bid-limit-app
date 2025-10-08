-- atomic_swap_and_check.lua (REVISED)
-- KEYS:
-- 1 = listingWinnerKey: "auction:{auctionUuid}:listing:{listingUuid}:winner"
-- 2 = userActivePrefix: "auction:{auctionUuid}:userActiveLots:" (append userUuid)
-- 3 = userBidLimitHashKey: "auction:{auctionUuid}:userBidLimit"
-- 4 = userToRegistrantHashKey: "auction:{auctionUuid}:userToRegistrant"
--
-- ARGV:
-- 1 = newUserUuid
-- 2 = listingUuid

local listingKey            = KEYS[1]
local activePrefix          = KEYS[2]
local bidLimitHash          = KEYS[3]
local userToRegistrantHash  = KEYS[4]

local newUser     = ARGV[1]
local listingUuid = ARGV[2]

-- current (old) winner
local oldUser = redis.call('GET', listingKey)
if oldUser == false then oldUser = nil end

-- NOOP if already winner
if oldUser ~= nil and oldUser == newUser then
  local curCount = redis.call('SCARD', activePrefix .. newUser)
  return { "NOOP", tostring(curCount), newUser, listingUuid, oldUser or "" }
end

-- remove listing from old user's active set (if any)
if oldUser and oldUser ~= '' then
  redis.call('SREM', activePrefix .. oldUser, listingUuid)
end

-- add listing to new user's active set
redis.call('SADD', activePrefix .. newUser, listingUuid)

-- compute counts (after provisional swap)
local newCount = redis.call('SCARD', activePrefix .. newUser)
local oldCount = 0
if oldUser and oldUser ~= '' then
  oldCount = redis.call('SCARD', activePrefix .. oldUser)
end

-- fetch limits
local newLimitStr = redis.call('HGET', bidLimitHash, newUser)
local oldLimitStr = oldUser and redis.call('HGET', bidLimitHash, oldUser) or nil

-- treat empty/missing as unlimited
local unlimitedNew = (not newLimitStr) or newLimitStr == ''
local unlimitedOld = (not oldLimitStr) or oldLimitStr == ''

-- helper: resolve registrantUuid
local function registrantFor(user)
  if not user or user == '' then return '' end
  local r = redis.call('HGET', userToRegistrantHash, user)
  if not r then return '' end
  return r
end
local newRegistrant = registrantFor(newUser)
local oldRegistrant = registrantFor(oldUser)

-- parse numeric limits
local newLimit = tonumber(newLimitStr)
local oldLimit = tonumber(oldLimitStr)

-- If new is unlimited or invalid limit -> commit as OK
if unlimitedNew or (newLimit == nil) then
  redis.call('SET', listingKey, newUser)
  return { "OK", tostring(newCount), newUser, listingUuid, oldUser or "", tostring(oldCount), newRegistrant, oldRegistrant }
end

-- Within or equal to limit -> commit as OK; if exactly at limit, return ATLIMIT (still committed)
if newCount < newLimit then
  redis.call('SET', listingKey, newUser)
  return { "OK", tostring(newCount), newUser, listingUuid, oldUser or "", tostring(oldCount), newRegistrant, oldRegistrant }
elseif newCount == newLimit then
  redis.call('SET', listingKey, newUser)
  return { "ATLIMIT", tostring(newCount), newUser, listingUuid, oldUser or "", tostring(oldCount), newRegistrant, oldRegistrant }
end

-- newCount > newLimit -> rollback swap and report EXCEEDED
redis.call('SREM', activePrefix .. newUser, listingUuid)
if oldUser and oldUser ~= '' then
  redis.call('SADD', activePrefix .. oldUser, listingUuid)
end
-- listing winner stays as oldUser (no SET)
return { "EXCEEDED", tostring(newCount), newUser, listingUuid, oldUser or "", tostring(oldCount), newRegistrant, oldRegistrant }
