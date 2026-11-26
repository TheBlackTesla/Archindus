CREATE TABLE account_routing_feedback (
 user_id TEXT NOT NULL,
 item TEXT NOT NULL,
 model TEXT NOT NULL,
 task TEXT NOT NULL,
 rating INTEGER NOT NULL CHECK(rating IN (-1,0,1)),
 PRIMARY KEY(user_id,item)
);
