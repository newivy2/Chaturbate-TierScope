export function parseGetChatUserListResponse(text) {
    if (typeof text !== 'string' || !text.trim()) throw new Error('Empty API response');
    var parts = text.trim().split(',');
    if (!/^\d+$/.test(parts[0])) throw new Error('Invalid API anonymous count');
    var anonymousCount = Number(parts[0]);
    if (!Number.isSafeInteger(anonymousCount)) throw new Error('Unsafe API anonymous count');
    var firstUser = 1;
    // Some responses include a second numeric metadata header. It is not a viewer.
    if (parts.length > 1 && /^\d+$/.test(parts[1])) {
        if (!Number.isSafeInteger(Number(parts[1]))) throw new Error('Unsafe API metadata count');
        firstUser = 2;
    }
    var classTiers = { m: 'red', f: 'green', l: 'purple', p: 'pink', tr: 'dark-blue', t: 'light-blue', g: 'gray' };
    var genders = { m: 'male', f: 'female', s: 'trans', c: 'couple' };
    var seen = new Set();
    var parsedUsers = [];
    var unknownClasses = Object.create(null);
    var unknownGenders = Object.create(null);
    for (var i = firstUser; i < parts.length; i++) {
        var fields = parts[i].split('|');
        if (fields.length !== 4 || !/^[A-Za-z0-9_-]{2,30}$/.test(fields[0]) ||
            fields.slice(1).some(function(field) { return !/^[^\s|,<>\x00-\x1f]+$/.test(field); })) {
            throw new Error('Malformed API record at index ' + i);
        }
        var username = fields[0];
        var key = username.toLowerCase();
        if (seen.has(key)) throw new Error('Duplicate API username at index ' + i);
        seen.add(key);
        var rawClass = fields[1];
        var genderCode = fields[2];
        var isOwner = rawClass === 'o';
        var tier = Object.prototype.hasOwnProperty.call(classTiers, rawClass) ? classTiers[rawClass] : null;
        var gender = Object.prototype.hasOwnProperty.call(genders, genderCode) ? genders[genderCode] : 'unknown';
        if (!tier && !isOwner) unknownClasses[rawClass] = (unknownClasses[rawClass] || 0) + 1;
        if (gender === 'unknown') unknownGenders[genderCode] = (unknownGenders[genderCode] || 0) + 1;
        parsedUsers.push({ username: username, rawClass: rawClass, tier: tier,
            genderCode: genderCode, gender: gender, rawFlag: fields[3], isOwner: isOwner });
    }
    var registeredCount = parsedUsers.length;
    var totalUsers = anonymousCount + registeredCount;
    if (!Number.isSafeInteger(totalUsers)) throw new Error('Unsafe API total users');
    return { anonymousCount: anonymousCount, registeredCount: registeredCount,
        totalUsers: totalUsers, users: parsedUsers,
        diagnostics: { unknownClasses: unknownClasses, unknownGenders: unknownGenders } };
}

export function validateRoomSnapshot(snapshot) {
    if (!snapshot || !Number.isSafeInteger(snapshot.roomTotal) || snapshot.roomTotal < 0 ||
        !Array.isArray(snapshot.users)) throw new Error('Invalid room snapshot');
    if (snapshot.source === 'API' &&
        (!Number.isSafeInteger(snapshot.anonymousCount) || snapshot.anonymousCount < 0 ||
         snapshot.registeredCount !== snapshot.users.length ||
         snapshot.totalUsers !== snapshot.anonymousCount + snapshot.registeredCount ||
         snapshot.roomTotal !== snapshot.totalUsers)) {
        throw new Error('Inconsistent API anonymous, registered, or total user counts');
    }
}
