import https from 'https';

const url = 'https://xtglinks.com/st?api=0d677cf4096a7a8cfb737c54f7fc8b3a4d043669&url=https://google.com';

https.get(url, (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  res.on('end', () => {
    console.log('Response:', data);
  });
}).on('error', (err) => {
  console.log('Error:', err.message);
});
