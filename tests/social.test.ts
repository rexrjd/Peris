import assert from 'node:assert/strict';
import test from 'node:test';
import {canManageMember,mergeMessages,validateGuild,type GuildMember,type Message} from '../src/features/social/domain/social';
test('guild profile validation accepts compact tags and rejects unusable names',()=>{
 assert.equal(validateGuild('Solar Covenant','SUN'),null);assert.ok(validateGuild('x','SUN'));assert.ok(validateGuild('Solar Covenant','TOO LONG'));assert.ok(validateGuild('Solar Covenant','<x>'));
});
test('guild rank hierarchy cannot remove self, peers or leadership',()=>{
 const officer={id:'officer',rank:80}as GuildMember,member={id:'member',rank:20}as GuildMember,leader={id:'leader',rank:100}as GuildMember;
 assert.ok(canManageMember(officer,member,true));assert.ok(!canManageMember(officer,leader,true));assert.ok(!canManageMember(officer,officer,true));assert.ok(!canManageMember(officer,member,false));
});
test('overlapping message pages preserve older history and stable chronological order',()=>{
 const m=(id:number,body='message')=>({id,body})as Message;
 const merged=mergeMessages([m(3),m(4),m(5)],[m(1),m(2),m(3,'updated')]);assert.deepEqual(merged.map(m=>m.id),[1,2,3,4,5]);assert.equal(merged[2].body,'updated');
});
