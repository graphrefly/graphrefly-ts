import importlib.util,unittest
from unittest.mock import Mock,patch
spec=importlib.util.spec_from_file_location('runner','scripts/causal-performance-coverage.py');r=importlib.util.module_from_spec(spec);spec.loader.exec_module(r)
class Cleanup(unittest.TestCase):
 def test_terminated(self):
  p=Mock();p.poll.return_value=0
  with patch.object(r,'wake',return_value='same'):self.assertEqual(r.finish(p),([], 'same',None))
  p.kill.assert_not_called()
 def test_kill_error_still_waits(self):
  p=Mock();p.poll.return_value=None;p.kill.side_effect=PermissionError('denied')
  with patch.object(r,'wake',return_value='same'):
   errors,w,e=r.finish(p);self.assertEqual(len(errors),1);self.assertEqual(w,'same');self.assertIsNone(e)
  p.wait.assert_called_once_with(timeout=3)
 def test_multiple_errors_preserved(self):
  p=Mock();p.poll.return_value=None;p.kill.side_effect=PermissionError('kill');p.wait.side_effect=TimeoutError('wait')
  with patch.object(r,'wake',side_effect=RuntimeError('wake')):
   errors,w,e=r.finish(p);self.assertEqual(len(errors),2);self.assertIsNone(w);self.assertIn('wake',e)
 def test_spawn_failed(self):
  with patch.object(r,'wake',side_effect=RuntimeError('wake')):self.assertIsNotNone(r.finish(None)[2])
if __name__=='__main__':unittest.main()
