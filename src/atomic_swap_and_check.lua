-- atomic_swap_and_check.lua
-- KEYS:
-- 1 = listingWinnerKey (string) e.g. "auction:{auctionUuid}:listing:{listingUuid}:winner"
-- 2 = userActivePrefix (prefix for sets) e.g. "auction:{auctionUuid}:userActiveLots:"  (we'll append userUuid)
-- 3 = userBidLimitHashKey e.g. "auction:{auctionUuid}:userBidLimit"
-- 4 = userToRegistrantHashKey e.g. "auction:{auctionUuid}:userToRegistrant"
--
-- ARGV:
-- 1 = newUserUuid
-- 2 = listingUuid

local listingKey = KEYS[1]
local activePrefix = KEYS[2]
local bidLimitHash = KEYS[3]
local userToRegistrantHash = KEYS[4]

local newUser = ARGV[1]
local listingUuid = ARGV[2]

-- read old winner
local oldUser = redis.call('GET', listingKey)
if oldUser == false then oldUser = nil end

-- no-op: if already winner, return NOOP
if oldUser ~= nil and oldUser == newUser then
  return { "NOOP" }
end

-- remove listing from old user's active set (if any)
if oldUser and oldUser ~= '' then
  redis.call('SREM', activePrefix .. oldUser, listingUuid)
end

-- add listing to new user's active set
redis.call('SADD', activePrefix .. newUser, listingUuid)

-- compute new user's active count
local count = redis.call('SCARD', activePrefix .. newUser)

-- get limit
local limit = redis.call('HGET', bidLimitHash, newUser)
-- treat empty or missing as unlimited
if (not limit) or limit == '' then
  -- set listing winner to newUser and return OK,count
  redis.call('SET', listingKey, newUser)
  return { "OK", tostring(count) }
end

-- numeric comparison
local nlimit = tonumber(limit)
local ncount = tonumber(count)

if nlimit == nil then
  -- invalid limit value; treat as unlimited (safe default)
  redis.call('SET', listingKey, newUser)
  return { "OK", tostring(count) }
end

if ncount < nlimit then
  -- within limit: commit
  redis.call('SET', listingKey, newUser)
  return { "OK", tostring(count) }
else
  -- limit reached: send dignal to Js script
  return { "ATLIMIT", tostring(ncount), registrantUuid }
end
