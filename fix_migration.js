require('dotenv').config();
const mongoose = require('mongoose');
const Team = require('./models/Team');
const User = require('./models/User');
const PaymentRequest = require('./models/PaymentRequest');

const TEAM_CODE = '020065';

const pendingBalances = {
  'Nr Karthick': 10,
  'Mani': 120,
  'Muthukalai': 90,
  'Pk Karthick': 60,
  'Suresh': 60,
  'Senthil': 120,
  'Tv Venkatesh': 60,
  'Ranjith': 140,
  'Ragu': 40,
  'Surya': 40
};

async function fix() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to Database');

    const team = await Team.findOne({ code: TEAM_CODE }).populate('players');
    if (!team) {
      console.log('Team not found');
      process.exit(1);
    }

    // Group users by amount
    const groups = {};
    for (const player of team.players) {
      let amount = 0;
      for (const [key, val] of Object.entries(pendingBalances)) {
        if (key.toLowerCase() === player.username.toLowerCase()) {
          amount = val;
          break;
        }
      }
      
      if (amount > 0) {
        if (!groups[amount]) groups[amount] = [];
        groups[amount].push(player._id);
      }
    }

    for (const [amountStr, userIds] of Object.entries(groups)) {
      const amount = Number(amountStr);
      
      // Check if a migration request already exists for this amount
      const existing = await PaymentRequest.findOne({
        teamId: team._id,
        notes: `Migration Due - ${amount}`,
      });
      
      if (!existing) {
        const pr = new PaymentRequest({
          teamId: team._id,
          createdBy: team.createdBy,
          dueAmount: amount,
          notes: `Migration Due - ${amount}`,
          isActive: true,
          players: userIds.map(id => ({
            userId: id,
            status: 'pending'
          }))
        });
        await pr.save();
        console.log(`✅ Created PaymentRequest for amount ${amount} with ${userIds.length} players`);
      } else {
        console.log(`⚠️ PaymentRequest for amount ${amount} already exists. Skipping.`);
      }
    }

    console.log('\nFix Completed Successfully!');
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

fix();
