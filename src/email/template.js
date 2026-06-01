export const SEND_EMAIL_CODE = (code) => `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MedRemind Password Reset</title>

<style>
body{
    font-family: Arial, sans-serif;
    background:#f6f6f6;
    margin:0;
    padding:0;
}

.container{
    max-width:600px;
    margin:auto;
    background:#ffffff;
    border-radius:8px;
    padding:30px;
    border:1px solid #E1E1E1;
}

.header{
    text-align:center;
    margin-bottom:25px;
}

.header h2{
    color:#00C26F;
    margin:0;
}

.header p{
    color:#7C7C7C;
    margin-top:6px;
}

.body p{
    color:#494949;
    line-height:1.6;
}

.code-box{
    margin:25px 0;
    text-align:center;
}

.code{
    display:inline-block;
    font-size:28px;
    letter-spacing:6px;
    font-weight:bold;
    padding:14px 28px;
    border-radius:6px;
    background:#e3e3e3;
    color:#1D1D1D;
}

.note{
    font-size:14px;
    color:#7C7C7C;
    margin-top:20px;
}

.footer{
    text-align:center;
    margin-top:30px;
    font-size:12px;
    color:#7C7C7C;
}

hr{
    border:none;
    border-top:1px solid #E1E1E1;
    margin:25px 0;
}
</style>
</head>

<body>

<div class="container">

<div class="header">
<h2>Blood Donar Hub</h2>
<p>OTP Code</p>
</div>

<div class="body">

<p>Hello,</p>

<p>Thanks for registering at <strong>Blood Donar Hub</strong>. Use the code below to verify your email address and continue.</p>

<div class="code-box">
<span class="code">${code}</span>
</div>


</div>
<hr>

<div class="footer">
<p>© ${new Date().getFullYear()} Blood Donar Hub</p>
<p>Your smart medication reminder</p>
</div>
</div>
</body>
</html>
`;

{/* <p class="note">
This code will expire in <strong>30 minutes</strong>.
If you did not request a password reset, you can safely ignore this email.
</p> */}