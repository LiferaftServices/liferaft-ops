-- Each shop's own mailbox is copied on its USCG notices.
update locations set uscg_notice_cc = 'service@survivalatsea.com' where code = 'york';
update locations set uscg_notice_cc = 'belfast@survivalatsea.com' where code = 'belfast';
