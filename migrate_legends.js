require('dotenv').config();
const mongoose = require('mongoose');
const Team = require('./models/Team');
const User = require('./models/User');
const PlayerLedger = require('./models/PlayerLedger');
const Expense = require('./models/Expense');

const TEAM_CODE = '020065';

const expensesToAdd = [
  { amount: 80, category: 'Equipment', description: 'TN 59 Ball (Manual Migration)' },
  { amount: 20, category: 'Refreshments', description: 'Water (Yogesh) (Manual Migration)' },
  { amount: 375, category: 'Other', description: 'Team Expenses (Manual Migration)' }
];

const pendingBalances = {
  'Nr Karthick': 10,
  'Mani': 120,
  'Muthukalai': 90,
  'Pk Karthick': 60,
  'Suresh': 60,
  'Senthil': 120,
  'Tv Venkatesh': 60,
  'Ranjith': 140,
  // 'Tv Karthick': 20, // Not found in DB, skipping
  'Ragu': 40,
  'Surya': 40
};

async function migrate() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to Database');

    const team = await Team.findOne({ code: TEAM_CODE }).populate('players');
    if (!team) {
      console.log('Team not found!');
      process.exit(1);
    }

    console.log(`Migrating data for Team: ${team.name}`);

    // 1. Update Team Balances
    // The user stated Total Balances amount = 1355
    // Expenses = 80 + 20 + 375 = 475
    // So Total Collected = 1355 + 475 = 1830
    team.balance = 1355;
    team.totalExpenses = 475;
    team.totalCollected = 1830;
    await team.save();
    console.log('✅ Team balances updated (Balance: 1355, Expenses: 475)');

    // 2. Add Expenses
    for (const expData of expensesToAdd) {
      const expense = new Expense({
        ...expData,
        date: new Date('2026-04-26T12:00:00Z'),
        teamId: team._id,
        addedBy: team.createdBy // assigning to manager
      });
      await expense.save();
    }
    console.log('✅ Manual expenses added');

    // 3. Update Player Ledgers
    for (const player of team.players) {
      const usernameRegex = new RegExp(`^${player.username}$`, 'i');
      
      // Find if this player is in our pending list (case-insensitive)
      let pendingAmount = 0;
      for (const [key, val] of Object.entries(pendingBalances)) {
        if (key.toLowerCase() === player.username.toLowerCase()) {
          pendingAmount = val;
          break;
        }
      }

      // Find or create ledger
      let ledger = await PlayerLedger.findOne({ userId: player._id, teamId: team._id });
      if (!ledger) {
        ledger = new PlayerLedger({ userId: player._id, teamId: team._id });
      }

      ledger.totalDue = pendingAmount;
      ledger.totalPaid = 0;
      ledger.pendingAmount = pendingAmount;
      ledger.advanceBalance = 0;
      
      await ledger.save();
      console.log(`✅ Ledger updated for ${player.username}: Pending ₹${pendingAmount}`);
    }

    console.log('\nMigration Completed Successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

migrate();
