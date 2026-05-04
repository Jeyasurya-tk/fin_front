require('dotenv').config();
const mongoose = require('mongoose');
const Team = require('./models/Team');
const User = require('./models/User');

async function inspect() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('Connected to DB');
  
  const team = await Team.findOne({ code: '020065' }).populate('players');
  if (!team) {
    console.log('Team not found');
  } else {
    console.log('Team:', team.name, 'Balance:', team.balance);
    console.log('Players:');
    team.players.forEach(p => console.log(`- ${p.username} (${p.mobile})`));
  }
  process.exit();
}
inspect().catch(console.error);
