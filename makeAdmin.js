require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

const makeAdmin = async () => {
  const mobile = process.argv[2];
  if (!mobile) {
    console.error('❌ Please provide a mobile number. Usage: node makeAdmin.js 9876543210');
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/cricket_finance');
    console.log('✅ Connected to MongoDB');

    const user = await User.findOneAndUpdate(
      { mobile },
      { role: 'admin' },
      { new: true }
    );

    if (user) {
      console.log(`🎉 Success! User ${user.username} (${user.mobile}) is now an ADMIN.`);
    } else {
      console.log(`❌ User with mobile number ${mobile} not found.`);
    }
  } catch (err) {
    console.error('Error:', err);
  } finally {
    process.exit(0);
  }
};

makeAdmin();
